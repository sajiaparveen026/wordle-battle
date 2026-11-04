-- Wordle Battle: Series Mode, STAGE 2 (rounds, between-round popup data, overall result). Run once AFTER 014_series_mode.sql. Safe to run again.
--
-- HOW IT WORKS
--  * Round 1 is the lobby room. When it starts, the first series_sync call snapshots the players into series_players.
--  * Every round is a normal room (battle_rooms / tz_rooms) with a series_id, so the existing gameplay, guesses, hints, timers and
--    sync are used as they are. When a round room is finished, series_sync records it (series_rounds) exactly once and, right away,
--    creates the NEXT round's room for the same players with a brand new secret word that starts 5 seconds later (server clock).
--    The next word is never sent to anyone before the round starts (the room view only shows the word once a room is finished).
--  * A round is won only by solving the word (first solver; or the player left when the other forfeits). If nobody solves it
--    (time up, or everyone is out of attempts) the round is a DRAW and nobody gets a round win.
--  * After the last round (or when fewer than 2 players are left) the series is finished: most round wins = overall winner;
--    equal top wins, or no wins at all = overall draw.
--  * Series rooms are marked reward_claimed so the normal battle reward is never paid for them. Series rewards come in Stage 3.
--  * Nothing existing is edited. Every client polls series_sync about once a second; it locks the series row, so two players
--    reporting the same round end at the same instant are handled one after the other and the round is recorded once.

alter table public.series add column if not exists current_room   uuid;
alter table public.series add column if not exists overall_result text check (overall_result in ('win', 'draw'));
alter table public.series add column if not exists overall_winner_seat int;
alter table public.series add column if not exists end_reason      text;
alter table public.series add column if not exists completed_at    timestamptz;

create table if not exists public.series_players (
  id         uuid primary key default gen_random_uuid(),
  series_id  uuid not null references public.series(id) on delete cascade,
  seat       int  not null,
  user_id    uuid references auth.users(id) on delete cascade,
  guest_pid  uuid,
  key_hash   text,
  username   text not null,
  avatar     text not null default '🦊',
  wins       int  not null default 0,
  unique (series_id, seat)
);
alter table public.series_players enable row level security;
revoke all on public.series_players from public, anon, authenticated;

create table if not exists public.series_rounds (
  series_id   uuid not null references public.series(id) on delete cascade,
  round_no    int  not null,
  room_id     uuid,
  secret_word text,
  meaning     text,
  result      text not null check (result in ('win', 'draw')),
  winner_seat int,
  end_reason  text,
  ended_at    timestamptz not null default now(),
  next_at     timestamptz,                                  -- when the next round starts (NULL after the last round)
  primary key (series_id, round_no)
);
alter table public.series_rounds enable row level security;
revoke all on public.series_rounds from public, anon, authenticated;

-- ---------------------------------------------------------------- internal: make the next round's room (NULL if fewer than 2 players are still here)
create or replace function public.series_make_next(p_series uuid, p_old uuid, p_next timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.series%rowtype; w text; nid uuid; code text; tries int := 0; i int; n int;
        cutoff timestamptz := clock_timestamp() - interval '75 seconds';
        alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  select * into s from public.series where id = p_series;
  -- a word that has not been used in this series
  select word into w from public.battle_words
   where is_answer and word not in (select secret_word from public.series_rounds where series_id = p_series and secret_word is not null)
   order by random() limit 1;
  if w is null then return null; end if;

  if s.mode = 'friend' then
    select count(*) into n from public.battle_players where room_id = p_old and connection_status <> 'left' and last_seen > cutoff;
    if n < 2 then return null; end if;
    loop
      code := ''; for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
      begin
        insert into public.battle_rooms (room_code, host_user_id, host_guest_pid, difficulty, duration_seconds, status, secret_word,
                                         expires_at, started_at, ends_at, series_id, series_round, prev_room_id)
        select code, o.host_user_id, o.host_guest_pid, o.difficulty, o.duration_seconds, 'playing', w,
               p_next + make_interval(secs => o.duration_seconds + 3600), p_next, p_next + make_interval(secs => o.duration_seconds),
               o.series_id, o.series_round + 1, o.id
          from public.battle_rooms o where o.id = p_old
        returning id into nid;
        exit;
      exception when unique_violation then tries := tries + 1; if tries > 20 then return null; end if;
      end;
    end loop;
    insert into public.battle_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar, is_ready, reward_claimed)
    select nid, seat, user_id, guest_pid, key_hash, username, avatar, true, true
      from public.battle_players where room_id = p_old and connection_status <> 'left' and last_seen > cutoff;
  else
    select count(*) into n from public.tz_players where room_id = p_old and not left_game and last_seen > cutoff;
    if n < 2 then return null; end if;
    loop
      code := ''; for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
      begin
        insert into public.tz_rooms (room_code, host_user_id, host_guest_pid, max_players, difficulty, duration_seconds, status, secret_word,
                                     expires_at, started_at, ends_at, series_id, series_round)
        select code, o.host_user_id, o.host_guest_pid, o.max_players, o.difficulty, o.duration_seconds, 'playing', w,
               p_next + make_interval(secs => o.duration_seconds + 3600), p_next, p_next + make_interval(secs => o.duration_seconds),
               o.series_id, o.series_round + 1
          from public.tz_rooms o where o.id = p_old
        returning id into nid;
        exit;
      exception when unique_violation then tries := tries + 1; if tries > 20 then return null; end if;
      end;
    end loop;
    insert into public.tz_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar, is_ready, reward_claimed)
    select nid, seat, user_id, guest_pid, key_hash, username, avatar, true, true
      from public.tz_players where room_id = p_old and not left_game and last_seen > cutoff;
  end if;
  return nid;
end $$;

-- ---------------------------------------------------------------- internal: close the series and work out the overall result
create or replace function public.series_finish(p_series uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare mx int; cnt int; ws int;
begin
  select coalesce(max(wins), 0) into mx from public.series_players where series_id = p_series;
  select count(*) into cnt from public.series_players where series_id = p_series and wins = mx;
  if mx > 0 and cnt = 1 then select seat into ws from public.series_players where series_id = p_series and wins = mx; end if;
  update public.series
     set status = 'finished', completed_at = clock_timestamp(), end_reason = p_reason,
         overall_result = case when ws is null then 'draw' else 'win' end, overall_winner_seat = ws
   where id = p_series and status <> 'finished';
end $$;

-- ---------------------------------------------------------------- the door the app calls (about once a second while a series is on)
create or replace function public.series_sync(p_series uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare s public.series%rowtype; a record; rid uuid; fr public.battle_rooms%rowtype; tr public.tz_rooms%rowtype;
        bp public.battle_players%rowtype; tp public.tz_players%rowtype; rstatus text;
        ws int; res text; reason text; w text; mean text; nxt timestamptz; nid uuid; last_round boolean; rno int;
        players json; rounds json; lr json;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  select * into s from public.series where id = p_series for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;

  rid := s.current_room;
  if rid is null then
    if s.mode = 'friend' then select id into rid from public.battle_rooms where series_id = s.id and series_round = 1;
    else select id into rid from public.tz_rooms where series_id = s.id and series_round = 1; end if;
  end if;
  if rid is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;

  -- settle the current room (timeouts, absent players) and check that the caller is in it
  if s.mode = 'friend' then
    fr := public.bt_settle(rid);
    bp := public.bt_mine(rid, p_pid, p_secret);
    if bp.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
    if bp.connection_status <> 'left' then update public.battle_players set last_seen = clock_timestamp() where id = bp.id; end if;
    rstatus := fr.status;
  else
    tr := public.tz_settle(rid);
    tp := public.tz_mine(rid, p_pid, p_secret);
    if tp.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
    if not tp.left_game then update public.tz_players set last_seen = clock_timestamp() where id = tp.id; end if;
    rstatus := tr.status;
  end if;

  -- the lobby room has started: freeze the player list, and make sure the normal battle reward can never be paid for series rooms
  if s.status = 'lobby' then
    if rstatus not in ('playing', 'finished') then return json_build_object('ok', true, 'lobby', true, 'series', public.series_json(s.id)); end if;
    if s.mode = 'friend' then
      insert into public.series_players (series_id, seat, user_id, guest_pid, key_hash, username, avatar)
      select s.id, seat, user_id, guest_pid, key_hash, username, avatar from public.battle_players where room_id = rid;
      update public.battle_players set reward_claimed = true where room_id = rid;
    else
      insert into public.series_players (series_id, seat, user_id, guest_pid, key_hash, username, avatar)
      select s.id, seat, user_id, guest_pid, key_hash, username, avatar from public.tz_players where room_id = rid and not left_game;
      update public.tz_players set reward_claimed = true where room_id = rid;
    end if;
    update public.series set status = 'playing', current_round = 1, current_room = rid where id = s.id;
    select * into s from public.series where id = s.id;
  end if;

  -- the current round is over and not recorded yet: record it once, then build the next round
  if s.status = 'playing' and rstatus = 'finished' and not exists (select 1 from public.series_rounds where series_id = s.id and round_no = s.current_round) then
    rno := s.current_round;
    if s.mode = 'friend' then
      select * into fr from public.battle_rooms where id = rid;
      w := fr.secret_word; reason := fr.end_reason;
      if fr.end_reason in ('solved', 'forfeit') and fr.winner_player_id is not null then
        select seat into ws from public.battle_players where id = fr.winner_player_id;
      end if;
    else
      select * into tr from public.tz_rooms where id = rid;
      w := tr.secret_word; reason := tr.end_reason;
      if tr.end_reason = 'solved' then
        select seat into ws from public.tz_players where room_id = rid and player_status = 'solved' order by completion_ms asc nulls last, seat limit 1;
      end if;
    end if;
    res := case when ws is null then 'draw' else 'win' end;
    select e->>1 into mean from public.battle_words bw, jsonb_array_elements(bw.clue) e where bw.word = w and e->>0 = 'meaning' limit 1;
    last_round := rno >= s.total_rounds;
    nxt := clock_timestamp() + interval '5 seconds';
    insert into public.series_rounds (series_id, round_no, room_id, secret_word, meaning, result, winner_seat, end_reason, next_at)
    values (s.id, rno, rid, w, mean, res, ws, reason, case when last_round then null else nxt end);
    if ws is not null then update public.series_players set wins = wins + 1 where series_id = s.id and seat = ws; end if;

    if not last_round then
      nid := public.series_make_next(s.id, rid, nxt);
      if nid is null then
        update public.series_rounds set next_at = null where series_id = s.id and round_no = rno;   -- fewer than 2 players are left
        perform public.series_finish(s.id, 'players_left');
      else
        update public.series set current_round = rno + 1, current_room = nid where id = s.id;
      end if;
    else
      perform public.series_finish(s.id, 'completed');
    end if;
    select * into s from public.series where id = s.id;
  end if;

  -- what the app needs
  select coalesce(json_agg(json_build_object('seat', sp.seat, 'username', sp.username, 'avatar', sp.avatar, 'wins', sp.wins,
            'is_me', ((a.uid is not null and sp.user_id = a.uid) or (a.uid is null and sp.guest_pid = p_pid and sp.key_hash = a.h)))
            order by sp.wins desc, sp.seat), '[]'::json) into players
    from public.series_players sp where sp.series_id = s.id;
  select coalesce(json_agg(json_build_object('round_no', r.round_no, 'result', r.result, 'winner_seat', r.winner_seat,
            'winner_name', sp.username, 'winner_avatar', sp.avatar) order by r.round_no), '[]'::json) into rounds
    from public.series_rounds r left join public.series_players sp on sp.series_id = r.series_id and sp.seat = r.winner_seat
   where r.series_id = s.id;
  select json_build_object('round_no', r.round_no, 'result', r.result, 'word', r.secret_word, 'meaning', r.meaning,
            'winner_name', sp.username, 'winner_avatar', sp.avatar, 'winner_seat', r.winner_seat, 'end_reason', r.end_reason,
            'next_at_ms', (extract(epoch from r.next_at) * 1000)::bigint, 'is_last', (r.next_at is null)) into lr
    from public.series_rounds r left join public.series_players sp on sp.series_id = r.series_id and sp.seat = r.winner_seat
   where r.series_id = s.id order by r.round_no desc limit 1;

  return json_build_object('ok', true,
    'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'series', public.series_json(s.id),
    'room_id', s.current_room,
    'players', players, 'rounds', rounds, 'last_round', lr,
    'overall', case when s.status = 'finished' then json_build_object('result', s.overall_result, 'winner_seat', s.overall_winner_seat, 'end_reason', s.end_reason) end);
end $$;

revoke all on function public.series_make_next(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.series_finish(uuid, text) from public, anon, authenticated;
revoke all on function public.series_sync(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.series_sync(uuid, uuid, text) to anon, authenticated;