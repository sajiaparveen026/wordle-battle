-- Wordle Battle: Team Zone results, rewards, Add Friend, rematch, reconnection. Run AFTER 010_team_zone_play.sql.
-- Needs 007_friends.sql to have been run (Add Friend uses the friends tables and functions).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- REWARDS (decided here, never in the app)
--  * Placement rewards come from the table tz_rewards (edit it in the Table Editor to change amounts).
--  * The last place (including a tie for last) earns 0 coins and 0 XP. A player who left mid-battle earns 0.
--  * Each player's reward is claimed once (reward_claimed). Asking again returns the same amounts, but granted = false.
-- REMATCH: one open request per battle. Everyone still in the battle must accept. Then a new room is made with the same
--  players, seats, size and difficulty, a new secret word, and a fresh countdown. If anyone declines, it is cancelled.
-- FRIEND ZONE: a trigger stops a player who is in a Team Zone battle from being put into a Friend Zone room. Friend Zone
--  code itself is not changed.

-- ---------------------------------------------------------------- tables / columns
create table if not exists public.tz_rewards (
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  place      int  not null check (place between 1 and 5),
  coins      int  not null check (coins >= 0),
  xp         int  not null check (xp >= 0),
  primary key (difficulty, place)
);
alter table public.tz_rewards enable row level security;
revoke all on public.tz_rewards from public, anon, authenticated;
insert into public.tz_rewards (difficulty, place, coins, xp) values
  ('easy', 1, 40, 60), ('easy', 2, 25, 35), ('easy', 3, 15, 20), ('easy', 4, 5, 10),
  ('medium', 1, 50, 70), ('medium', 2, 30, 45), ('medium', 3, 20, 30), ('medium', 4, 10, 15),
  ('hard', 1, 60, 80), ('hard', 2, 40, 55), ('hard', 3, 25, 35), ('hard', 4, 10, 20)
on conflict (difficulty, place) do nothing;

alter table public.tz_rooms add column if not exists rematch_by uuid;                   -- seat id of the player who asked
alter table public.tz_rooms add column if not exists rematch_expires timestamptz;
alter table public.tz_rooms add column if not exists rematch_new_room uuid;             -- the new room, once everyone agreed
alter table public.tz_players add column if not exists rematch_vote boolean;

-- ================================================================ helpers

-- What a player earns for this battle, as JSON {coins, xp}.
create or replace function public.tz_reward_json(p_room uuid, p_player uuid) returns json
language plpgsql security definer stable set search_path = '' as $$
declare r public.tz_rooms%rowtype; p public.tz_players%rowtype; last int; rw public.tz_rewards%rowtype;
begin
  select * into r from public.tz_rooms where id = p_room;
  select * into p from public.tz_players where id = p_player;
  if p.id is null or p.left_game or p.finish_place is null then return json_build_object('coins', 0, 'xp', 0); end if;
  select max(finish_place) into last from public.tz_players where room_id = p_room;
  if p.finish_place >= last then return json_build_object('coins', 0, 'xp', 0); end if;     -- last place (or tied last): nothing
  select * into rw from public.tz_rewards where difficulty = r.difficulty and place = least(p.finish_place, 5);
  return json_build_object('coins', coalesce(rw.coins, 0), 'xp', coalesce(rw.xp, 0));
end $$;

-- Friend relationship between two players in a battle, from my side: self / friends / sent / incoming / none.
create or replace function public.tz_friend_state(p_me public.tz_players, p_other public.tz_players) returns text
language plpgsql security definer stable set search_path = '' as $$
declare a uuid := public.fr_resolve(coalesce(p_me.user_id, p_me.guest_pid)); b uuid := public.fr_resolve(coalesce(p_other.user_id, p_other.guest_pid));
begin
  if a = b then return 'self'; end if;
  if public.fr_are_friends(a, b) then return 'friends'; end if;
  if exists (select 1 from public.friend_requests where sender_id = a and receiver_id = b and status = 'pending') then return 'sent'; end if;
  if exists (select 1 from public.friend_requests where sender_id = b and receiver_id = a and status = 'pending') then return 'incoming'; end if;
  return 'none';
end $$;

-- Is any player who is still in this battle already in another live room (team or friend)?
create or replace function public.tz_anyone_busy(p_room uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.tz_players p
     where p.room_id = p_room and not p.left_game
       and (exists (select 1 from public.tz_players q join public.tz_rooms rr on rr.id = q.room_id
                     where q.room_id <> p_room and not q.left_game and rr.status in ('waiting', 'playing')
                       and ((p.user_id is not null and q.user_id = p.user_id) or (p.user_id is null and q.guest_pid = p.guest_pid)))
            or exists (select 1 from public.battle_players b join public.battle_rooms br on br.id = b.room_id
                     where br.status in ('waiting', 'lobby', 'playing')
                       and ((p.user_id is not null and b.user_id = p.user_id) or (p.user_id is null and b.guest_pid = p.guest_pid))))
  );
$$;

-- What a player may see. Adds: rewards per player, Add Friend state, and the rematch status.
create or replace function public.tz_view(r public.tz_rooms, me public.tz_players) returns json
language plpgsql security definer stable set search_path = '' as $$
declare players json; my_guesses json; fin boolean := (r.status = 'finished'); rm json; need int; yes int;
begin
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'seat', p.seat, 'username', p.username, 'avatar', p.avatar,
           'is_me', (p.id = me.id), 'is_host', (p.seat = 1), 'ready', p.is_ready,
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
           'friend_state', case when fin and p.id <> me.id and me.id is not null then public.tz_friend_state(me, p) end
         ) order by p.seat), '[]'::json) into players
    from public.tz_players p where p.room_id = r.id;

  select coalesce(json_agg(json_build_object('word', g.word, 'pattern', g.pattern) order by g.n), '[]'::json) into my_guesses
    from public.tz_guesses g where g.player_id = me.id;

  select count(*) into need from public.tz_players where room_id = r.id and not left_game;
  select count(*) into yes from public.tz_players where room_id = r.id and not left_game and rematch_vote is true;
  rm := json_build_object(
          'state', case when r.rematch_new_room is not null then 'started'
                        when r.rematch_by is not null and r.rematch_expires > clock_timestamp() then 'open' else 'none' end,
          'requested_by', case when r.rematch_expires > clock_timestamp() then r.rematch_by end,
          'by_me', (r.rematch_by = me.id),
          'voted', coalesce(me.rematch_vote, false),
          'votes', yes, 'needed', need,
          'expires_in_ms', greatest(0, (extract(epoch from (r.rematch_expires - clock_timestamp())) * 1000)::bigint),
          'new_room_id', r.rematch_new_room);

  return json_build_object(
    'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'room', json_build_object(
        'id', r.id, 'code', r.room_code, 'difficulty', r.difficulty, 'duration_seconds', r.duration_seconds,
        'max_players', r.max_players, 'status', r.status, 'version', r.version, 'end_reason', r.end_reason,
        'started_at_ms', (extract(epoch from r.started_at) * 1000)::bigint,
        'ends_at_ms',    (extract(epoch from r.ends_at) * 1000)::bigint),
    'players', players,
    'me', json_build_object('id', me.id, 'seat', me.seat, 'is_host', (me.seat = 1),
                            'status', me.player_status, 'guesses', my_guesses,
                            'hints_used', to_json(me.hints_used), 'hint_data', me.hint_data,
                            'reward_claimed', me.reward_claimed, 'left', me.left_game),
    'answer', case when fin then r.secret_word end,
    'rematch', rm);
end $$;

-- Rooms I am in that are still going, or finished with a reward I have not collected yet (so a refresh shows the result again).
create or replace function public.tz_get_active(p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; m record; r public.tz_rooms%rowtype; fin uuid; act json := null;
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
  return json_build_object('ok', true, 'active', act, 'unclaimed_room_id', fin);
end $$;

-- ================================================================ public doors

-- Collect my reward for a finished battle. Pays exactly once (granted = false on every later call).
create or replace function public.tz_claim_reward(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; me public.tz_players%rowtype; rw json; got uuid;
begin
  r := public.tz_settle(p_room);
  me := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'finished' then return json_build_object('ok', false, 'reason', 'not_finished'); end if;
  rw := public.tz_reward_json(r.id, me.id);
  update public.tz_players set reward_claimed = true where id = me.id and not reward_claimed returning id into got;
  return json_build_object('ok', true, 'granted', got is not null,
                           'coins', (rw->>'coins')::int, 'xp', (rw->>'xp')::int,
                           'place', me.finish_place, 'outcome', case when me.finish_place = 1 then 'win' else 'loss' end);
end $$;

-- Add Friend from a result card. The server checks both players were in this battle.
create or replace function public.tz_add_friend(p_room uuid, p_target uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; me public.tz_players%rowtype; t public.tz_players%rowtype; a uuid; b uuid; rq public.friend_requests%rowtype; rid uuid;
begin
  r := public.tz_settle(p_room);
  me := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'finished' then return json_build_object('ok', false, 'reason', 'not_finished'); end if;
  select * into t from public.tz_players where id = p_target and room_id = r.id;
  if t.id is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  a := public.fr_resolve(coalesce(me.user_id, me.guest_pid)); b := public.fr_resolve(coalesce(t.user_id, t.guest_pid));
  if a = b then return json_build_object('ok', false, 'reason', 'self'); end if;
  if public.fr_are_friends(a, b) then return json_build_object('ok', true, 'status', 'friends'); end if;
  if exists (select 1 from public.friend_requests where sender_id = a and receiver_id = b and status = 'pending') then
    return json_build_object('ok', true, 'status', 'sent');
  end if;
  select * into rq from public.friend_requests where sender_id = b and receiver_id = a and status = 'pending' for update;
  if found then                                                    -- they already asked me: that is a yes from both sides
    perform public.fr_accept_core(rq.id);
    return json_build_object('ok', true, 'status', 'friends');
  end if;
  if (select count(*) from public.friend_requests where sender_id = a and created_at > now() - interval '1 hour') >= 20 then
    return json_build_object('ok', false, 'reason', 'throttled');
  end if;
  if (select count(*) from public.friendships where player_one_id = a or player_two_id = a) >= 200 then
    return json_build_object('ok', false, 'reason', 'friend_limit');
  end if;
  begin
    insert into public.friend_requests (sender_id, receiver_id) values (a, b) returning id into rid;
  exception when unique_violation then
    return json_build_object('ok', true, 'status', 'sent');
  end;
  insert into public.notifications (receiver_id, type, related_id) values (b, 'friend_request', rid) on conflict do nothing;
  perform public.fr_notify(b);
  perform public.fr_notify(a);
  return json_build_object('ok', true, 'status', 'sent');
end $$;

-- Ask for a rematch with the same team. Everyone still in the battle must accept.
create or replace function public.tz_rematch_request(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; me public.tz_players%rowtype; host public.tz_players%rowtype; n int;
begin
  r := public.tz_settle(p_room);
  me := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'finished' then return json_build_object('ok', false, 'reason', 'not_finished'); end if;
  if me.left_game then return json_build_object('ok', false, 'reason', 'left'); end if;
  if r.rematch_new_room is not null then return json_build_object('ok', false, 'reason', 'already_started', 'state', public.tz_view(r, me)); end if;
  if r.rematch_by is not null and r.rematch_expires > clock_timestamp() then
    return json_build_object('ok', true, 'state', public.tz_view(r, me));              -- already asked: a second tap changes nothing
  end if;
  select * into host from public.tz_players where room_id = r.id and seat = 1;
  if host.left_game then return json_build_object('ok', false, 'reason', 'host_left', 'state', public.tz_view(r, me)); end if;
  select count(*) into n from public.tz_players where room_id = r.id and not left_game;
  if n < 2 then return json_build_object('ok', false, 'reason', 'no_opponents', 'state', public.tz_view(r, me)); end if;
  if public.tz_anyone_busy(r.id) then return json_build_object('ok', false, 'reason', 'busy', 'state', public.tz_view(r, me)); end if;

  update public.tz_players set rematch_vote = null where room_id = r.id;
  update public.tz_players set rematch_vote = true where id = me.id;
  update public.tz_rooms set rematch_by = me.id, rematch_expires = clock_timestamp() + interval '45 seconds', rematch_new_room = null where id = r.id;
  perform public.tz_bump(r.id);
  r := public.tz_settle(p_room);
  select * into me from public.tz_players where id = me.id;
  return json_build_object('ok', true, 'state', public.tz_view(r, me));
end $$;

-- Accept or decline a rematch. When the last player accepts, the new battle starts at once.
create or replace function public.tz_rematch_respond(p_room uuid, p_accept boolean, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; me public.tz_players%rowtype; nr uuid; code text; alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        i int; tries int := 0; left_n int;
begin
  r := public.tz_settle(p_room);
  me := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'finished' or r.rematch_new_room is not null then return json_build_object('ok', false, 'reason', 'no_request', 'state', public.tz_view(r, me)); end if;
  if r.rematch_by is null or r.rematch_expires <= clock_timestamp() then return json_build_object('ok', false, 'reason', 'no_request', 'state', public.tz_view(r, me)); end if;
  if me.left_game then return json_build_object('ok', false, 'reason', 'left'); end if;

  if not coalesce(p_accept, false) then
    update public.tz_players set rematch_vote = null where room_id = r.id;
    update public.tz_rooms set rematch_by = null, rematch_expires = null where id = r.id;
    perform public.tz_bump(r.id);
    select * into r from public.tz_rooms where id = p_room; select * into me from public.tz_players where id = me.id;
    return json_build_object('ok', true, 'declined', true, 'state', public.tz_view(r, me));
  end if;

  update public.tz_players set rematch_vote = true where id = me.id;
  select count(*) into left_n from public.tz_players where room_id = r.id and not left_game and coalesce(rematch_vote, false) is false;
  if left_n > 0 then
    perform public.tz_bump(r.id);
    select * into r from public.tz_rooms where id = p_room; select * into me from public.tz_players where id = me.id;
    return json_build_object('ok', true, 'waiting', true, 'state', public.tz_view(r, me));
  end if;

  -- everyone agreed: make the new battle with the same players, seats, size and difficulty
  if public.tz_anyone_busy(r.id) then
    update public.tz_players set rematch_vote = null where room_id = r.id;
    update public.tz_rooms set rematch_by = null, rematch_expires = null where id = r.id;
    perform public.tz_bump(r.id);
    select * into r from public.tz_rooms where id = p_room; select * into me from public.tz_players where id = me.id;
    return json_build_object('ok', false, 'reason', 'busy', 'state', public.tz_view(r, me));
  end if;

  loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
    begin
      insert into public.tz_rooms (room_code, host_user_id, host_guest_pid, max_players, difficulty, duration_seconds, status, expires_at)
      values (code, r.host_user_id, r.host_guest_pid, r.max_players, r.difficulty, r.duration_seconds, 'waiting', now() + interval '1 hour')
      returning id into nr;
      exit;
    exception when unique_violation then
      tries := tries + 1; if tries > 20 then return json_build_object('ok', false, 'reason', 'try_again'); end if;
    end;
  end loop;
  insert into public.tz_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar, is_ready, last_seen)
  select nr, seat, user_id, guest_pid, key_hash, username, avatar, false, clock_timestamp()
    from public.tz_players where room_id = r.id and not left_game;
  perform public.tz_start(nr);
  update public.tz_rooms set rematch_new_room = nr, rematch_by = null, rematch_expires = null where id = r.id;
  update public.tz_players set rematch_vote = null where room_id = r.id;
  perform public.tz_bump(r.id);
  select * into r from public.tz_rooms where id = p_room; select * into me from public.tz_players where id = me.id;
  return json_build_object('ok', true, 'started', true, 'new_room_id', nr, 'state', public.tz_view(r, me));
end $$;

-- ================================================================ Friend Zone: no joining while in a Team Zone battle
create or replace function public.tz_block_friend_join() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tz_players p join public.tz_rooms r on r.id = p.room_id
              where r.status in ('waiting', 'playing') and not p.left_game
                and ((new.user_id is not null and p.user_id = new.user_id)
                  or (new.user_id is null and p.guest_pid = new.guest_pid and p.key_hash = new.key_hash))) then
    raise exception 'in_team_room' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists bp_block_team on public.battle_players;
create trigger bp_block_team before insert on public.battle_players
  for each row execute function public.tz_block_friend_join();

revoke all on function public.tz_reward_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tz_friend_state(public.tz_players, public.tz_players) from public, anon, authenticated;
revoke all on function public.tz_anyone_busy(uuid) from public, anon, authenticated;
revoke all on function public.tz_block_friend_join() from public, anon, authenticated;
revoke all on function public.tz_claim_reward(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tz_add_friend(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tz_rematch_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tz_rematch_respond(uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.tz_claim_reward(uuid, uuid, text) to anon, authenticated;
grant execute on function public.tz_add_friend(uuid, uuid, uuid, text) to anon, authenticated;
grant execute on function public.tz_rematch_request(uuid, uuid, text) to anon, authenticated;
grant execute on function public.tz_rematch_respond(uuid, boolean, uuid, text) to anon, authenticated;
grant execute on function public.tz_get_active(uuid, text) to anon, authenticated;
