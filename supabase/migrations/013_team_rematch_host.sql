-- Wordle Battle: Team Zone rematch, host-controlled. Run AFTER 011_team_zone_results.sql (012 is independent).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- WHAT CHANGES (Team Zone only; Friend Zone code and tables are not touched)
--  * Only the room's host (the player who created the room) can start a rematch. The server checks this; hiding the button is
--    not what protects it.
--  * Every request has its own id (rematch_id) and a status: open / declined / expired / cancelled / busy / started.
--    The request lasts 30 seconds. The host counts as ready; everyone else must accept.
--  * Each player's answer is kept (rematch_vote: true = accepted, false = declined, null = no answer yet), so the host can see
--    who accepted, who declined and who did not answer. A new request clears the answers.
--  * Any decline ends the request. A lapsed request is marked 'expired' by the server (tz_settle), and everyone is told through
--    the same Realtime "tick" the rest of Team Zone uses.
--  * Accepts are handled one at a time (the room row is locked), so two players accepting at the same moment cannot leave the
--    request stuck, and the new battle is made exactly once (unique index on rematch_of).
--  * The new battle has a new room id, a new code, a new secret word (never the same word as the battle just played), and every
--    attempt, clue, power-up and timer starts fresh.
--  * tz_get_active also reports an open request, so a refresh or reconnect brings a player back to the result screen.

-- ---------------------------------------------------------------- columns
alter table public.tz_rooms add column if not exists rematch_id     uuid;                -- one id per request
alter table public.tz_rooms add column if not exists rematch_status text;
alter table public.tz_rooms add column if not exists rematch_of     uuid references public.tz_rooms(id) on delete set null;   -- set on the NEW battle: which battle it replays
do $$ begin
  alter table public.tz_rooms add constraint tz_rooms_rematch_status_chk
    check (rematch_status is null or rematch_status in ('open', 'declined', 'expired', 'cancelled', 'busy', 'started'));
exception when duplicate_object then null; end $$;
create unique index if not exists tz_rooms_one_rematch on public.tz_rooms (rematch_of) where rematch_of is not null;   -- a battle can only be replayed once

-- ================================================================ helpers

-- Is this player the host (the creator) of this room?
create or replace function public.tz_is_host(r public.tz_rooms, p public.tz_players) returns boolean
language sql immutable set search_path = '' as $$
  select p.id is not null and (
         (r.host_user_id is not null and p.user_id = r.host_user_id)
      or (r.host_user_id is null and r.host_guest_pid is not null and p.guest_pid = r.host_guest_pid)
      or (r.host_user_id is null and r.host_guest_pid is null and p.seat = 1));
$$;

-- Apply whatever is due. Same as before, plus: a rematch request that ran out of time becomes 'expired'.
create or replace function public.tz_settle(p_room uuid) returns public.tz_rooms
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; host public.tz_players%rowtype; n int;
begin
  select * into r from public.tz_rooms where id = p_room for update;
  if not found then return r; end if;

  if r.status = 'waiting' then
    select * into host from public.tz_players where room_id = r.id and seat = 1;
    if r.expires_at < clock_timestamp() or host.id is null or host.last_seen < clock_timestamp() - interval '75 seconds' then
      update public.tz_rooms set status = 'expired' where id = r.id;
      perform public.tz_bump(r.id);
    else
      delete from public.tz_players where room_id = r.id and seat > 1 and last_seen < clock_timestamp() - interval '75 seconds';
      get diagnostics n = row_count;
      if n > 0 then
        update public.tz_players set is_ready = false where room_id = r.id;
        perform public.tz_bump(r.id);
      end if;
    end if;

  elsif r.status = 'playing' then
    if clock_timestamp() >= r.ends_at then
      perform public.tz_finish(r.id, 'timeout');
    elsif not exists (select 1 from public.tz_players p where p.room_id = r.id and p.player_status = 'active' and not p.left_game) then
      perform public.tz_finish(r.id, 'failed');
    end if;

  elsif r.status = 'finished' then
    if r.rematch_status = 'open' and r.rematch_new_room is null and r.rematch_expires <= clock_timestamp() then
      update public.tz_rooms set rematch_status = 'expired' where id = r.id;
      perform public.tz_bump(r.id);
    end if;
  end if;

  select * into r from public.tz_rooms where id = p_room;
  return r;
end $$;

-- What a player may see. Same as 011, plus: host by room (not by seat), each player's rematch answer, and the request id/state.
create or replace function public.tz_view(r public.tz_rooms, me public.tz_players) returns json
language plpgsql security definer stable set search_path = '' as $$
declare players json; my_guesses json; fin boolean := (r.status = 'finished'); rm json; need int; yes int; host_id uuid; st text;
begin
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'seat', p.seat, 'username', p.username, 'avatar', p.avatar,
           'is_me', (p.id = me.id), 'is_host', public.tz_is_host(r, p), 'ready', p.is_ready,
           'connection', case when p.left_game then 'left'
                              when p.last_seen > clock_timestamp() - interval '15 seconds' then 'connected'
                              when p.last_seen > clock_timestamp() - interval '75 seconds' then 'reconnecting'
                              else 'disconnected' end,
           'attempts_used', p.attempts_used, 'status', p.player_status,
           'completion_ms', case when p.player_status = 'solved' or fin then p.completion_ms end,
           'finish_place', case when fin then p.finish_place end,
           'best_exact',   case when fin or p.id = me.id then p.best_exact end,
           'best_present', case when fin or p.id = me.id then p.best_present end,
           'reward', case when fin then public.tz_reward_json(r.id, p.id) end,
           'friend_state', case when fin and p.id <> me.id and me.id is not null then public.tz_friend_state(me, p) end,
           'rematch', case when fin and r.rematch_id is not null and not p.left_game
                           then case when p.rematch_vote is true then 'accepted' when p.rematch_vote is false then 'declined' else 'waiting' end end
         ) order by p.seat), '[]'::json) into players
    from public.tz_players p where p.room_id = r.id;

  select coalesce(json_agg(json_build_object('word', g.word, 'pattern', g.pattern) order by g.n), '[]'::json) into my_guesses
    from public.tz_guesses g where g.player_id = me.id;

  select p.id into host_id from public.tz_players p where p.room_id = r.id and public.tz_is_host(r, p) limit 1;
  select count(*) into need from public.tz_players where room_id = r.id and not left_game;
  select count(*) into yes from public.tz_players where room_id = r.id and not left_game and rematch_vote is true;
  st := case when r.rematch_new_room is not null then 'started'
             when r.rematch_status = 'open' and r.rematch_expires <= clock_timestamp() then 'expired'
             else coalesce(r.rematch_status, 'none') end;
  rm := json_build_object(
          'id', r.rematch_id, 'state', st,
          'host_id', host_id, 'requested_by', case when st = 'open' then host_id end,
          'by_me', (host_id = me.id),
          'voted', me.rematch_vote,
          'votes', yes, 'needed', need,
          'expires_in_ms', case when st = 'open' then greatest(0, (extract(epoch from (r.rematch_expires - clock_timestamp())) * 1000)::bigint) else 0 end,
          'new_room_id', r.rematch_new_room);

  return json_build_object(
    'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'room', json_build_object(
        'id', r.id, 'code', r.room_code, 'difficulty', r.difficulty, 'duration_seconds', r.duration_seconds,
        'max_players', r.max_players, 'status', r.status, 'version', r.version, 'end_reason', r.end_reason,
        'started_at_ms', (extract(epoch from r.started_at) * 1000)::bigint,
        'ends_at_ms',    (extract(epoch from r.ends_at) * 1000)::bigint),
    'players', players,
    'me', json_build_object('id', me.id, 'seat', me.seat, 'is_host', public.tz_is_host(r, me),
                            'status', me.player_status, 'guesses', my_guesses,
                            'hints_used', to_json(me.hints_used), 'hint_data', me.hint_data,
                            'reward_claimed', me.reward_claimed, 'left', me.left_game),
    'answer', case when fin then r.secret_word end,
    'rematch', rm);
end $$;

-- Rooms I am in that are still going, a finished one with a reward I have not collected, or a finished one with an open rematch
-- request (so a refresh or reconnect puts me back on the result screen where the request is shown).
create or replace function public.tz_get_active(p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; m record; r public.tz_rooms%rowtype; fin uuid; rmr uuid; act json := null;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  for m in select distinct r2.id from public.tz_rooms r2 join public.tz_players p on p.room_id = r2.id
            where r2.status in ('waiting', 'playing') and not p.left_game
              and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
  loop
    r := public.tz_settle(m.id);
    if r.status in ('waiting', 'playing') then act := json_build_object('room_id', r.id, 'status', r.status); exit; end if;
  end loop;
  select r2.id into fin from public.tz_rooms r2 join public.tz_players p on p.room_id = r2.id
   where r2.status = 'finished' and not p.reward_claimed and not p.left_game and r2.completed_at > now() - interval '3 days'
     and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
   order by r2.completed_at desc limit 1;
  select r2.id into rmr from public.tz_rooms r2 join public.tz_players p on p.room_id = r2.id
   where r2.status = 'finished' and r2.rematch_status = 'open' and r2.rematch_new_room is null and r2.rematch_expires > clock_timestamp()
     and not p.left_game
     and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
   order by r2.rematch_expires desc limit 1;
  return json_build_object('ok', true, 'active', act, 'unclaimed_room_id', fin, 'rematch_room_id', rmr);
end $$;

-- ================================================================ public doors

-- HOST ONLY: ask the same team for a rematch. Makes one new request (new id, 30 seconds). The host counts as ready.
create or replace function public.tz_rematch_request(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; me public.tz_players%rowtype; n int;
begin
  r := public.tz_settle(p_room);                         -- also locks the room row until this call ends: two taps can never make two requests
  me := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'finished' then return json_build_object('ok', false, 'reason', 'not_finished'); end if;
  if me.left_game then return json_build_object('ok', false, 'reason', 'left'); end if;
  if not public.tz_is_host(r, me) then return json_build_object('ok', false, 'reason', 'not_host', 'state', public.tz_view(r, me)); end if;
  if r.rematch_new_room is not null then return json_build_object('ok', false, 'reason', 'already_started', 'state', public.tz_view(r, me)); end if;
  if r.rematch_status = 'open' then return json_build_object('ok', true, 'state', public.tz_view(r, me)); end if;   -- already open: a second tap changes nothing
  select count(*) into n from public.tz_players where room_id = r.id and not left_game and id <> me.id;
  if n < 1 then return json_build_object('ok', false, 'reason', 'no_opponents', 'state', public.tz_view(r, me)); end if;
  if public.tz_anyone_busy(r.id) then return json_build_object('ok', false, 'reason', 'busy', 'state', public.tz_view(r, me)); end if;

  update public.tz_players set rematch_vote = null where room_id = r.id;                 -- a fresh request starts from a clean slate
  update public.tz_players set rematch_vote = true where id = me.id;
  update public.tz_rooms
     set rematch_id = gen_random_uuid(), rematch_status = 'open', rematch_by = me.id,
         rematch_expires = clock_timestamp() + interval '30 seconds', rematch_new_room = null
   where id = r.id;
  perform public.tz_bump(r.id);
  select * into r from public.tz_rooms where id = p_room;
  select * into me from public.tz_players where id = me.id;
  return json_build_object('ok', true, 'state', public.tz_view(r, me));
end $$;

-- Everyone but the host: accept or decline. The answer is kept so the host can see it. The last accept starts the new battle.
create or replace function public.tz_rematch_respond(p_room uuid, p_accept boolean, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; me public.tz_players%rowtype; nr uuid; code text; alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        i int; tries int := 0; pending int;
begin
  r := public.tz_settle(p_room);                         -- locks the room row: simultaneous accepts are handled one after the other
  me := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'finished' then return json_build_object('ok', false, 'reason', 'no_request'); end if;
  if r.rematch_new_room is not null then return json_build_object('ok', false, 'reason', 'already_started', 'state', public.tz_view(r, me)); end if;
  if me.left_game then return json_build_object('ok', false, 'reason', 'left'); end if;
  if public.tz_is_host(r, me) then return json_build_object('ok', false, 'reason', 'host_cannot_respond', 'state', public.tz_view(r, me)); end if;
  if r.rematch_status is distinct from 'open' then return json_build_object('ok', false, 'reason', 'no_request', 'state', public.tz_view(r, me)); end if;
  if me.rematch_vote is not null then return json_build_object('ok', true, 'state', public.tz_view(r, me)); end if;      -- already answered: a second tap changes nothing

  if not coalesce(p_accept, false) then
    update public.tz_players set rematch_vote = false where id = me.id;
    update public.tz_rooms set rematch_status = 'declined' where id = r.id;           -- one decline cancels the request; the answers stay visible
    perform public.tz_bump(r.id);
    select * into r from public.tz_rooms where id = p_room; select * into me from public.tz_players where id = me.id;
    return json_build_object('ok', true, 'declined', true, 'state', public.tz_view(r, me));
  end if;

  update public.tz_players set rematch_vote = true where id = me.id;
  select count(*) into pending from public.tz_players where room_id = r.id and not left_game and rematch_vote is not true;
  if pending > 0 then
    perform public.tz_bump(r.id);
    select * into r from public.tz_rooms where id = p_room; select * into me from public.tz_players where id = me.id;
    return json_build_object('ok', true, 'waiting', true, 'state', public.tz_view(r, me));
  end if;

  -- everyone accepted
  if public.tz_anyone_busy(r.id) then
    update public.tz_rooms set rematch_status = 'busy' where id = r.id;
    perform public.tz_bump(r.id);
    select * into r from public.tz_rooms where id = p_room; select * into me from public.tz_players where id = me.id;
    return json_build_object('ok', false, 'reason', 'busy', 'state', public.tz_view(r, me));
  end if;

  loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
    begin
      insert into public.tz_rooms (room_code, host_user_id, host_guest_pid, max_players, difficulty, duration_seconds, status, expires_at, rematch_of)
      values (code, r.host_user_id, r.host_guest_pid, r.max_players, r.difficulty, r.duration_seconds, 'waiting', now() + interval '1 hour', r.id)
      returning id into nr;
      exit;
    exception when unique_violation then
      select id into nr from public.tz_rooms where rematch_of = r.id;                  -- this battle was already replayed: use that one, never make a second
      if nr is not null then exit; end if;
      tries := tries + 1; if tries > 20 then return json_build_object('ok', false, 'reason', 'try_again'); end if;
    end;
  end loop;
  if not exists (select 1 from public.tz_players where room_id = nr) then
    insert into public.tz_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar, is_ready, last_seen)
    select nr, seat, user_id, guest_pid, key_hash, username, avatar, false, clock_timestamp()
      from public.tz_players where room_id = r.id and not left_game;
    perform public.tz_start(nr);                                                       -- new word, new timer, clean attempts / clues / power-ups
    update public.tz_rooms                                                             -- never the same word as the battle just played
       set secret_word = (select w.word from public.battle_words w where w.is_answer and w.word <> r.secret_word order by random() limit 1)
     where id = nr and secret_word = r.secret_word;
  end if;
  update public.tz_rooms set rematch_new_room = nr, rematch_status = 'started' where id = r.id;
  perform public.tz_bump(r.id);
  select * into r from public.tz_rooms where id = p_room; select * into me from public.tz_players where id = me.id;
  return json_build_object('ok', true, 'started', true, 'new_room_id', nr, 'state', public.tz_view(r, me));
end $$;

-- HOST ONLY: take the open request back.
create or replace function public.tz_rematch_cancel(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; me public.tz_players%rowtype;
begin
  r := public.tz_settle(p_room);
  me := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not public.tz_is_host(r, me) then return json_build_object('ok', false, 'reason', 'not_host', 'state', public.tz_view(r, me)); end if;
  if r.rematch_new_room is null and r.rematch_status = 'open' then
    update public.tz_rooms set rematch_status = 'cancelled' where id = r.id;
    perform public.tz_bump(r.id);
    select * into r from public.tz_rooms where id = p_room;
  end if;
  return json_build_object('ok', true, 'state', public.tz_view(r, me));
end $$;

revoke all on function public.tz_is_host(public.tz_rooms, public.tz_players) from public, anon, authenticated;
revoke all on function public.tz_rematch_cancel(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tz_rematch_request(uuid, uuid, text) to anon, authenticated;
grant execute on function public.tz_rematch_respond(uuid, boolean, uuid, text) to anon, authenticated;
grant execute on function public.tz_rematch_cancel(uuid, uuid, text) to anon, authenticated;
grant execute on function public.tz_get_active(uuid, text) to anon, authenticated;
