-- Wordle Battle: Series Mode, STATS & HISTORY. Run once AFTER 017_series_hardening.sql. Safe to run again.
--
--  * Every completed series is already stored (series, series_players, series_rounds, series_rewards): that IS the history, so there is no second copy
--    that could disagree with the real result, and no duplicate records are possible.
--  * New: each round also keeps every player's result and attempts (series_rounds.details). Series played before this update simply show no attempts.
--  * Only COMPLETED series appear: status finished and end_reason 'completed'. Series ended early because players left, cancelled lobbies and
--    unfinished series are never shown, and a word is only ever returned for a finished series.
--  * Each player sees only series they took part in (by account, or by guest identity). Rows are never exposed directly (RLS on, no grants).
--  * Housekeeping change: the clean-up from 017 no longer deletes completed series, so history is kept. It still removes old lobbies, stuck series
--    and early-ended series (once their rewards are collected).
--  * A guest who creates an account keeps their history: series_adopt_guest moves their series seats to the account (the app calls it next to bt_adopt_guest).

alter table public.series_rounds add column if not exists details jsonb;

create or replace function public.series_round_details(p_mode text, p_room uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_mode = 'friend'
    then (select jsonb_agg(jsonb_build_object('seat', p.seat, 'status', p.player_status, 'attempts', p.attempts_used) order by p.seat) from public.battle_players p where p.room_id = p_room)
    else (select jsonb_agg(jsonb_build_object('seat', p.seat, 'status', p.player_status, 'attempts', p.attempts_used) order by p.seat) from public.tz_players p where p.room_id = p_room)
  end;
$$;
revoke all on function public.series_round_details(text, uuid) from public, anon, authenticated;

-- series_sync = the Stage 3 function plus: the round's per-player details are saved when the round is recorded
create or replace function public.series_sync(p_series uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare s public.series%rowtype; a record; rid uuid; fr public.battle_rooms%rowtype; tr public.tz_rooms%rowtype;
        bp public.battle_players%rowtype; tp public.tz_players%rowtype; rstatus text;
        ws int; res text; reason text; w text; mean text; nxt timestamptz; nid uuid; last_round boolean; rno int;
        players json; rounds json; lr json; me_seat int; det jsonb; myrw json; pend int; host boolean; again json; nsid_code text;
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
    det := public.series_round_details(s.mode, rid);                                  -- each player's result and attempts, kept for the history screen
    insert into public.series_rounds (series_id, round_no, room_id, secret_word, meaning, result, winner_seat, end_reason, next_at, details)
    values (s.id, rno, rid, w, mean, res, ws, reason, case when last_round then null else nxt end, det);
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

-- clean-up: keep completed series forever
create or replace function public.series_cleanup_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.series s
   where (s.status = 'finished' and s.end_reason <> 'completed' and s.completed_at < now() - interval '7 days'
          and not exists (select 1 from public.series_rewards r where r.series_id = s.id and not r.claimed))
      or (s.status = 'lobby' and s.created_at < now() - interval '1 day')
      or (s.status = 'cancelled' and s.created_at < now() - interval '1 day')
      or (s.status = 'playing' and s.created_at < now() - interval '2 days');
  return null;
end $$;
revoke all on function public.series_cleanup_trg() from public, anon, authenticated;

-- a guest who just created an account: move their series seats over (safe to repeat)
create or replace function public.series_adopt_guest(p_pid uuid, p_secret text) returns json
language plpgsql security definer set search_path = '' as $$
declare h text; n int;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_pid is null or p_secret is null or char_length(p_secret) < 24 or char_length(p_secret) > 100 then return json_build_object('ok', false); end if;
  h := encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
  update public.series_players sp set user_id = auth.uid(), guest_pid = null, key_hash = null
   where sp.guest_pid = p_pid and sp.key_hash = h
     and not exists (select 1 from public.series_players x where x.series_id = sp.series_id and x.user_id = auth.uid());
  get diagnostics n = row_count;
  update public.series set host_user_id = auth.uid(), host_guest_pid = null where host_guest_pid = p_pid;
  return json_build_object('ok', true, 'moved', n);
end $$;
revoke all on function public.series_adopt_guest(uuid, text) from public, anon, authenticated;
grant execute on function public.series_adopt_guest(uuid, text) to authenticated;

-- my history: totals over ALL my completed series, plus the newest p_limit series as cards
create or replace function public.series_history(p_pid uuid default null, p_secret text default null, p_limit int default 200) returns json
language plpgsql security definer stable set search_path = '' as $$
declare a record; out json; lim int := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  with mine as (
    select sp.series_id, sp.seat from public.series_players sp
     where (a.uid is not null and sp.user_id = a.uid) or (a.uid is null and sp.guest_pid = p_pid and sp.key_hash = a.h)
  ), base as (
    select s.id, s.mode, s.difficulty, s.total_rounds, s.completed_at, s.overall_result, s.overall_winner_seat, m.seat as my_seat,
           (select sp.wins from public.series_players sp where sp.series_id = s.id and sp.seat = m.seat) as my_wins,
           (select max(sp.wins) from public.series_players sp where sp.series_id = s.id) as top_wins,
           coalesce((select sum(r.coins) from public.series_rewards r where r.series_id = s.id and r.seat = m.seat), 0)::int as coins,
           coalesce((select sum(r.xp)    from public.series_rewards r where r.series_id = s.id and r.seat = m.seat), 0)::int as xp
      from public.series s join mine m on m.series_id = s.id
     where s.status = 'finished' and s.end_reason = 'completed'
  ), rr as (
    select b.*, case when b.overall_result = 'win' and b.overall_winner_seat = b.my_seat then 'won'
                     when b.overall_result = 'draw' and b.my_wins = b.top_wins then 'draw'
                     else 'lost' end as my_result
      from base b
  )
  select json_build_object('ok', true,
    'stats', (select json_build_object('played', count(*), 'won', count(*) filter (where my_result = 'won'), 'lost', count(*) filter (where my_result = 'lost'),
                                       'drawn', count(*) filter (where my_result = 'draw'), 'rounds_won', coalesce(sum(my_wins), 0), 'coins', coalesce(sum(coins), 0), 'xp', coalesce(sum(xp), 0)) from rr),
    'items', (select coalesce(json_agg(i.j order by i.completed_at desc), '[]'::json) from (
                select r.completed_at, json_build_object('series_id', r.id, 'completed_at', r.completed_at, 'mode', r.mode, 'difficulty', r.difficulty,
                         'total_rounds', r.total_rounds, 'my_seat', r.my_seat, 'my_result', r.my_result, 'my_wins', r.my_wins, 'coins', r.coins, 'xp', r.xp,
                         'overall_result', r.overall_result, 'winner_seat', r.overall_winner_seat,
                         'players', (select json_agg(json_build_object('seat', sp.seat, 'username', sp.username, 'avatar', sp.avatar, 'wins', sp.wins) order by sp.wins desc, sp.seat)
                                       from public.series_players sp where sp.series_id = r.id)) as j
                  from rr r order by r.completed_at desc limit lim) i)) into out;
  return out;
end $$;

-- one series in full (only a completed series I played in)
create or replace function public.series_detail(p_series uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer stable set search_path = '' as $$
declare a record; s public.series%rowtype; my int; top int; res text; coins int; xp int;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  select * into s from public.series where id = p_series and status = 'finished' and end_reason = 'completed';
  if s.id is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  select sp.seat into my from public.series_players sp
   where sp.series_id = s.id and ((a.uid is not null and sp.user_id = a.uid) or (a.uid is null and sp.guest_pid = p_pid and sp.key_hash = a.h));
  if my is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  select max(wins) into top from public.series_players where series_id = s.id;
  res := case when s.overall_result = 'win' and s.overall_winner_seat = my then 'won'
              when s.overall_result = 'draw' and (select wins from public.series_players where series_id = s.id and seat = my) = top then 'draw' else 'lost' end;
  select coalesce(sum(r.coins), 0)::int, coalesce(sum(r.xp), 0)::int into coins, xp from public.series_rewards r where r.series_id = s.id and r.seat = my;
  return json_build_object('ok', true,
    'series', json_build_object('id', s.id, 'mode', s.mode, 'difficulty', s.difficulty, 'duration_seconds', s.duration_seconds, 'total_rounds', s.total_rounds,
                                'completed_at', s.completed_at, 'overall_result', s.overall_result, 'winner_seat', s.overall_winner_seat),
    'players', (select json_agg(json_build_object('seat', sp.seat, 'username', sp.username, 'avatar', sp.avatar, 'wins', sp.wins, 'is_me', sp.seat = my) order by sp.wins desc, sp.seat)
                  from public.series_players sp where sp.series_id = s.id),
    'rounds', (select coalesce(json_agg(json_build_object('round_no', r.round_no, 'word', r.secret_word, 'meaning', r.meaning, 'result', r.result,
                          'winner_seat', r.winner_seat, 'winner_name', w.username, 'winner_avatar', w.avatar, 'details', r.details) order by r.round_no), '[]'::json)
                 from public.series_rounds r left join public.series_players w on w.series_id = r.series_id and w.seat = r.winner_seat
                where r.series_id = s.id),
    'me', json_build_object('seat', my, 'result', res, 'wins', (select wins from public.series_players where series_id = s.id and seat = my), 'coins', coins, 'xp', xp));
end $$;

revoke all on function public.series_history(uuid, text, int) from public, anon, authenticated;
revoke all on function public.series_detail(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.series_history(uuid, text, int) to anon, authenticated;
grant execute on function public.series_detail(uuid, uuid, text) to anon, authenticated;