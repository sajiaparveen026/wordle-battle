-- Wordle Battle: Series Mode, STAGE 3 (rewards + Play Again). Run once AFTER 015_series_rounds.sql. Safe to run again.
--
-- REWARDS (kept in ONE place: series_reward below; change the numbers here and nowhere else)
--   * a round winner gets 10 coins + 20 XP, written to the ledger the moment the round is recorded (so it is credited right after the round)
--   * the overall series winner gets an extra 50 coins + 50 XP, written when the series finishes
--   * drawn rounds, and a tied or all-draw series, write nothing
--   * the ledger (series_rewards) has one row per (series, player, kind, round), so a reward can never be written twice, and
--     series_claim marks each row claimed exactly once, so it can never be paid twice. The app adds the coins/XP only for rows that
--     series_claim just granted (and js/store.js refuses a repeated key as well).
--   * normal battle rewards are untouched (series rooms were already marked as claimed in Stage 2)
-- PLAY AGAIN: the host (seat 1) opens a NEW series with the same mode, difficulty, rounds and player cap. The others see it on their
--   result screen and join it with its code. New series id, new lobby, fresh words.

alter table public.series add column if not exists next_series uuid;

create table if not exists public.series_rewards (
  series_id  uuid not null references public.series(id) on delete cascade,
  seat       int  not null,
  kind       text not null check (kind in ('round', 'overall')),
  round_no   int  not null default 0,
  coins      int  not null,
  xp         int  not null,
  claimed    boolean not null default false,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (series_id, seat, kind, round_no)
);
alter table public.series_rewards enable row level security;
revoke all on public.series_rewards from public, anon, authenticated;

create or replace function public.series_reward(p_kind text, out coins int, out xp int) returns record
language sql immutable set search_path = '' as $$
  select case p_kind when 'round' then 10 when 'overall' then 50 else 0 end,
         case p_kind when 'round' then 20 when 'overall' then 50 else 0 end;
$$;
revoke all on function public.series_reward(text) from public, anon, authenticated;

-- close the series: overall result + the overall-winner reward
create or replace function public.series_finish(p_series uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare mx int; cnt int; ws int; done boolean;
begin
  select coalesce(max(wins), 0) into mx from public.series_players where series_id = p_series;
  select count(*) into cnt from public.series_players where series_id = p_series and wins = mx;
  if mx > 0 and cnt = 1 then select seat into ws from public.series_players where series_id = p_series and wins = mx; end if;
  update public.series
     set status = 'finished', completed_at = clock_timestamp(), end_reason = p_reason,
         overall_result = case when ws is null then 'draw' else 'win' end, overall_winner_seat = ws
   where id = p_series and status <> 'finished'
   returning true into done;
  if done and ws is not null then
    insert into public.series_rewards (series_id, seat, kind, round_no, coins, xp)
    select p_series, ws, 'overall', 0, rw.coins, rw.xp from public.series_reward('overall') rw
    on conflict do nothing;
  end if;
end $$;
revoke all on function public.series_finish(uuid, text) from public, anon, authenticated;

-- series_sync = the Stage 2 function plus: the round-win reward row, my rewards, how many are unclaimed, am I the host, the Play Again lobby
create or replace function public.series_sync(p_series uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare s public.series%rowtype; a record; rid uuid; fr public.battle_rooms%rowtype; tr public.tz_rooms%rowtype;
        bp public.battle_players%rowtype; tp public.tz_players%rowtype; rstatus text;
        ws int; res text; reason text; w text; mean text; nxt timestamptz; nid uuid; last_round boolean; rno int;
        players json; rounds json; lr json; me_seat int; myrw json; pend int; host boolean; again json; nsid_code text;
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
    if ws is not null then
      update public.series_players set wins = wins + 1 where series_id = s.id and seat = ws;
      insert into public.series_rewards (series_id, seat, kind, round_no, coins, xp)      -- the round-win reward, credited right after the round
      select s.id, ws, 'round', rno, rw.coins, rw.xp from public.series_reward('round') rw
      on conflict do nothing;
    end if;

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

  select sp.seat into me_seat from public.series_players sp
   where sp.series_id = s.id and ((a.uid is not null and sp.user_id = a.uid) or (a.uid is null and sp.guest_pid = p_pid and sp.key_hash = a.h));
  host := (me_seat = 1);
  select coalesce(json_agg(json_build_object('kind', x.kind, 'round_no', x.round_no, 'coins', x.coins, 'xp', x.xp) order by x.kind desc, x.round_no), '[]'::json) into myrw
    from public.series_rewards x where x.series_id = s.id and x.seat = me_seat;
  select count(*) into pend from public.series_rewards x where x.series_id = s.id and x.seat = me_seat and not x.claimed;
  if s.next_series is not null then
    select case when s.mode = 'friend' then (select room_code from public.battle_rooms where series_id = s.next_series and series_round = 1)
                else (select room_code from public.tz_rooms where series_id = s.next_series and series_round = 1) end into nsid_code;
    again := json_build_object('series_id', s.next_series, 'code', nsid_code);
  end if;

  return json_build_object('ok', true,
    'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'series', public.series_json(s.id),
    'room_id', s.current_room,
    'players', players, 'rounds', rounds, 'last_round', lr,
    'overall', case when s.status = 'finished' then json_build_object('result', s.overall_result, 'winner_seat', s.overall_winner_seat, 'end_reason', s.end_reason) end,
    'rewards', myrw, 'pending_rewards', pend, 'is_host', coalesce(host, false), 'again', again);
end $$;

revoke all on function public.series_sync(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.series_sync(uuid, uuid, text) to anon, authenticated;

-- collect my unpaid rewards (one series, or all my series when p_series is NULL). Returns only the rows granted by THIS call.
create or replace function public.series_claim(p_series uuid default null, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; res json;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  with mine as (
    select sp.series_id, sp.seat from public.series_players sp
     where (p_series is null or sp.series_id = p_series)
       and ((a.uid is not null and sp.user_id = a.uid) or (a.uid is null and sp.guest_pid = p_pid and sp.key_hash = a.h))
  ), upd as (
    update public.series_rewards r set claimed = true, claimed_at = clock_timestamp()
      from mine where r.series_id = mine.series_id and r.seat = mine.seat and not r.claimed
    returning r.series_id, r.kind, r.round_no, r.coins, r.xp
  )
  select coalesce(json_agg(json_build_object('series_id', u.series_id, 'kind', u.kind, 'round_no', u.round_no, 'coins', u.coins, 'xp', u.xp)), '[]'::json) into res from upd u;
  return json_build_object('ok', true, 'granted', res);
end $$;

-- Play Again (host only, series finished): a new series with the same settings and a new lobby for the host.
create or replace function public.series_again(p_series uuid, p_pid uuid default null, p_secret text default null,
                                               p_username text default null, p_avatar text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; s public.series%rowtype; res json; rid uuid; seat1 boolean;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  select * into s from public.series where id = p_series for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  select true into seat1 from public.series_players sp
   where sp.series_id = s.id and sp.seat = 1 and ((a.uid is not null and sp.user_id = a.uid) or (a.uid is null and sp.guest_pid = p_pid and sp.key_hash = a.h));
  if not coalesce(seat1, false) then return json_build_object('ok', false, 'reason', 'not_host'); end if;
  if s.status <> 'finished' then return json_build_object('ok', false, 'reason', 'not_finished'); end if;

  if s.next_series is not null then                              -- already opened: take the host back to it
    if s.mode = 'friend' then select id into rid from public.battle_rooms where series_id = s.next_series and series_round = 1 and status in ('waiting', 'lobby');
    else select id into rid from public.tz_rooms where series_id = s.next_series and series_round = 1 and status = 'waiting'; end if;
    if rid is not null then return json_build_object('ok', true, 'room_id', rid, 'series', public.series_json(s.next_series)); end if;
  end if;

  res := public.series_create(s.mode, s.difficulty, s.total_rounds, case when s.mode = 'team' then s.max_players end, p_pid, p_secret, p_username, p_avatar);
  if not coalesce((res->>'ok')::boolean, false) then return res; end if;
  update public.series set next_series = (res->'series'->>'id')::uuid where id = s.id;
  return res;
end $$;

revoke all on function public.series_claim(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.series_again(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.series_claim(uuid, uuid, text) to anon, authenticated;
grant execute on function public.series_again(uuid, uuid, text, text, text) to anon, authenticated;