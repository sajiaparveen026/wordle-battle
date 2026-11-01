-- Wordle Battle: Team Zone (3, 4 or 5 players in one room). Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again. Run it AFTER 006_friend_battle.sql and 006b_battle_words.sql (it reuses their identity helpers and word list).
-- Friend Zone (bt_*) is NOT changed by this file.
--
-- HOW IT IS PROTECTED (same model as Friend Zone)
--  * Every table has Row Level Security ON, no policies, no grants: the app can never read or write them directly.
--  * The only doors are the tz_* functions. They use the same caller check as Friend Zone (signed-in account, or guest id +
--    secret kept on the device), so no player can act for another player.
--  * Live updates use Supabase Realtime BROADCAST: a tiny "tick" (no game data) on the channel team:<room id>.
--  * Every action locks the room row first, so simultaneous joins / readies are processed one at a time.
--
-- TIMING: no always-on job. Waiting rooms that the host or a guest has left for 75 s, and rooms past their expiry,
-- are settled by the next request for that room (the app checks in every 3 s).

-- ---------------------------------------------------------------- rooms
create table if not exists public.tz_rooms (
  id               uuid primary key default gen_random_uuid(),
  room_code        text not null unique check (room_code ~ '^[A-Z0-9]{6}$'),
  host_user_id     uuid references auth.users(id) on delete set null,
  host_guest_pid   uuid,
  max_players      int  not null check (max_players between 3 and 5),
  difficulty       text not null check (difficulty in ('easy','medium','hard')),
  duration_seconds int  not null check (duration_seconds in (720, 480, 300)),       -- 12 / 8 / 5 minutes
  status           text not null default 'waiting'
                   check (status in ('waiting','playing','finished','cancelled','expired')),
  secret_word      text check (secret_word ~ '^[a-z]{5}$'),                          -- never leaves the database until the battle ends
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  started_at       timestamptz,
  ends_at          timestamptz,
  completed_at     timestamptz,
  version          int  not null default 0
);
create index if not exists tz_rooms_status_idx on public.tz_rooms (status, created_at);
alter table public.tz_rooms enable row level security;
revoke all on public.tz_rooms from public, anon, authenticated;

-- ---------------------------------------------------------------- players (seat 1 = host)
create table if not exists public.tz_players (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.tz_rooms(id) on delete cascade,
  seat              int  not null check (seat between 1 and 5),
  user_id           uuid references auth.users(id) on delete cascade,
  guest_pid         uuid,
  key_hash          text,                                                            -- sha256 of the guest's secret; never shown
  username          text not null,
  avatar            text not null default '🦊' check (char_length(avatar) between 1 and 8),
  is_ready          boolean not null default false,
  last_seen         timestamptz not null default now(),
  attempts_used     int  not null default 0 check (attempts_used between 0 and 6),
  player_status     text not null default 'active' check (player_status in ('active','solved','failed')),
  best_exact        int  not null default 0,
  best_present      int  not null default 0,
  hints_used        text[] not null default '{}',
  hint_data         jsonb  not null default '{}'::jsonb,
  completion_ms     int,
  finish_place      int,                                                             -- 1 = first solver, set when the battle ends
  reward_claimed    boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (room_id, seat),
  constraint tzp_owner check ((user_id is not null and guest_pid is null and key_hash is null)
                           or (user_id is null and guest_pid is not null and key_hash is not null))
);
create unique index if not exists tzp_room_user  on public.tz_players (room_id, user_id)   where user_id is not null;
create unique index if not exists tzp_room_guest on public.tz_players (room_id, guest_pid) where guest_pid is not null;
create index if not exists tzp_user_idx  on public.tz_players (user_id)   where user_id is not null;
create index if not exists tzp_guest_idx on public.tz_players (guest_pid) where guest_pid is not null;
alter table public.tz_players enable row level security;
revoke all on public.tz_players from public, anon, authenticated;

-- Players who forfeited a battle (left_game) are no longer in it: they can create or join rooms and are not sent back to it.
alter table public.tz_players add column if not exists left_game boolean not null default false;

-- ================================================================ internal helpers (not callable from the app)

-- Realtime tick (no game data). Never fails the caller.
create or replace function public.tz_notify(p_room uuid, p_version int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('v', p_version), 'tick', 'team:' || p_room::text, false);
exception when others then null;
end $$;

create or replace function public.tz_bump(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  update public.tz_rooms set version = version + 1 where id = p_room returning version into v;
  if v is not null then perform public.tz_notify(p_room, v); end if;
end $$;

-- The caller's seat in a team room (an all-NULL row when the caller is not in that room).
create or replace function public.tz_mine(p_room uuid, p_pid uuid, p_secret text) returns public.tz_players
language plpgsql security definer stable set search_path = '' as $$
declare a record; pl public.tz_players%rowtype;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return pl; end if;
  if a.uid is not null then
    select * into pl from public.tz_players where room_id = p_room and user_id = a.uid;
  else
    select * into pl from public.tz_players where room_id = p_room and guest_pid = p_pid and key_hash = a.h;
  end if;
  return pl;
end $$;

-- Is the caller in a Friend Zone room that is still alive? (settles it first, so stale rooms never block anyone)
create or replace function public.tz_friend_busy(p_uid uuid, p_pid uuid, p_h text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m record; fr public.battle_rooms%rowtype;
begin
  for m in select distinct r2.id from public.battle_rooms r2 join public.battle_players p on p.room_id = r2.id
            where r2.status in ('waiting', 'lobby', 'playing')
              and ((p_uid is not null and p.user_id = p_uid) or (p_uid is null and p.guest_pid = p_pid and p.key_hash = p_h))
  loop
    fr := public.bt_settle(m.id);
    if fr.status in ('waiting', 'lobby', 'playing') then return fr.id; end if;
  end loop;
  return null;
end $$;

-- Apply whatever is due: expired waiting rooms, players gone for 75 s, a battle whose time ran out.
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

  elsif r.status = 'playing' and clock_timestamp() >= r.ends_at then
    -- time is up (gameplay results arrive in the next stage)
    update public.tz_rooms set status = 'finished', completed_at = clock_timestamp() where id = r.id;
    perform public.tz_bump(r.id);
  end if;

  select * into r from public.tz_rooms where id = p_room;
  return r;
end $$;

-- What a player is allowed to see of a room: the lobby roster, and the room's settings.
create or replace function public.tz_view(r public.tz_rooms, me public.tz_players) returns json
language plpgsql security definer stable set search_path = '' as $$
declare players json;
begin
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'seat', p.seat, 'username', p.username, 'avatar', p.avatar,
           'is_me', (p.id = me.id), 'is_host', (p.seat = 1), 'ready', p.is_ready,
           'connection', case when p.last_seen > clock_timestamp() - interval '15 seconds' then 'connected'
                              when p.last_seen > clock_timestamp() - interval '75 seconds' then 'reconnecting'
                              else 'disconnected' end
         ) order by p.seat), '[]'::json) into players
    from public.tz_players p where p.room_id = r.id;

  return json_build_object(
    'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'room', json_build_object(
        'id', r.id, 'code', r.room_code, 'difficulty', r.difficulty, 'duration_seconds', r.duration_seconds,
        'max_players', r.max_players, 'status', r.status, 'version', r.version,
        'started_at_ms', (extract(epoch from r.started_at) * 1000)::bigint,
        'ends_at_ms',    (extract(epoch from r.ends_at) * 1000)::bigint),
    'players', players,
    'me', json_build_object('id', me.id, 'seat', me.seat, 'is_host', (me.seat = 1)));
end $$;

-- Start the battle once everyone is in and ready. The server picks the secret word and the clock; 3-second countdown.
create or replace function public.tz_start(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare w text; r public.tz_rooms%rowtype; st timestamptz := clock_timestamp() + interval '3 seconds';
begin
  select word into w from public.battle_words where is_answer order by random() limit 1;
  if w is null then raise exception 'battle word list is empty - run 006b_battle_words.sql'; end if;
  select * into r from public.tz_rooms where id = p_room;
  update public.tz_players
     set attempts_used = 0, player_status = 'active', best_exact = 0, best_present = 0, hints_used = '{}', hint_data = '{}'::jsonb,
         completion_ms = null, finish_place = null, reward_claimed = false, is_ready = true
   where room_id = p_room;
  update public.tz_rooms
     set status = 'playing', secret_word = w, started_at = st, ends_at = st + make_interval(secs => r.duration_seconds)
   where id = p_room;
  perform public.tz_bump(p_room);
end $$;

-- Old rooms are removed whenever someone creates one (their players go with them).
create or replace function public.tz_cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.tz_rooms
   where (status in ('expired', 'cancelled') and created_at < now() - interval '1 hour')
      or (status = 'waiting' and expires_at < now() - interval '1 hour')
      or (status = 'playing' and ends_at < now() - interval '1 hour')
      or (status = 'finished' and completed_at < now() - interval '3 days');
$$;

-- ================================================================ public doors (these are what the app calls)

-- Create a room of 3, 4 or 5 players. The caller is seat 1 (host).
create or replace function public.tz_create(p_difficulty text, p_max int, p_pid uuid default null, p_secret text default null,
                                            p_username text default null, p_avatar text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; ident record; secs int; code text; rid uuid; r public.tz_rooms%rowtype; pl public.tz_players%rowtype; mine record;
        alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; tries int := 0; i int;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  secs := case p_difficulty when 'easy' then 720 when 'medium' then 480 when 'hard' then 300 end;
  if secs is null then return json_build_object('ok', false, 'reason', 'bad_difficulty'); end if;
  if p_max is null or p_max not between 3 and 5 then return json_build_object('ok', false, 'reason', 'bad_size'); end if;
  perform public.tz_cleanup();

  -- already in a team room? settle it; if it is still alive, send the player back to it
  for mine in select distinct r2.id from public.tz_rooms r2 join public.tz_players p on p.room_id = r2.id
               where r2.status in ('waiting', 'playing')
                 and not p.left_game
                 and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
  loop
    r := public.tz_settle(mine.id);
    if r.status in ('waiting', 'playing') then
      return json_build_object('ok', false, 'reason', 'already_in_room', 'room_id', r.id);
    end if;
  end loop;

  if public.tz_friend_busy(a.uid, p_pid, a.h) is not null then return json_build_object('ok', false, 'reason', 'busy_friend'); end if;

  if (select count(*) from public.tz_rooms
       where created_at > now() - interval '1 minute'
         and ((a.uid is not null and host_user_id = a.uid) or (a.uid is null and host_guest_pid = p_pid))) >= 5 then
    return json_build_object('ok', false, 'reason', 'throttled');
  end if;

  select * into ident from public.bt_identity(p_username, p_avatar);
  loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
    begin
      insert into public.tz_rooms (room_code, host_user_id, host_guest_pid, max_players, difficulty, duration_seconds, expires_at)
      values (code, a.uid, case when a.uid is null then p_pid end, p_max, p_difficulty, secs, now() + interval '30 minutes')
      returning id into rid;
      exit;
    exception when unique_violation then
      tries := tries + 1; if tries > 20 then return json_build_object('ok', false, 'reason', 'try_again'); end if;
    end;
  end loop;

  insert into public.tz_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar)
  values (rid, 1, a.uid, case when a.uid is null then p_pid end, case when a.uid is null then a.h end, ident.uname, ident.av)
  returning * into pl;
  select * into r from public.tz_rooms where id = rid;
  return json_build_object('ok', true, 'state', public.tz_view(r, pl));
end $$;

-- Join with a room code. Only while the room is waiting and has a free seat.
create or replace function public.tz_join(p_code text, p_pid uuid default null, p_secret text default null,
                                          p_username text default null, p_avatar text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; ident record; code text; rid uuid; r public.tz_rooms%rowtype; pl public.tz_players%rowtype; mine record;
        other public.tz_rooms%rowtype; uname text; seat_no int; i int;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(code) <> 6 then return json_build_object('ok', false, 'reason', 'invalid_code'); end if;
  select id into rid from public.tz_rooms where room_code = code;
  if rid is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;

  r := public.tz_settle(rid);                                  -- locks the room: two joiners are handled one at a time
  pl := public.tz_mine(rid, p_pid, p_secret);
  if pl.id is not null then                                    -- already in this room (rejoin after a refresh)
    update public.tz_players set last_seen = clock_timestamp() where id = pl.id;
    select * into r from public.tz_rooms where id = rid;
    select * into pl from public.tz_players where id = pl.id;
    return json_build_object('ok', true, 'rejoined', true, 'state', public.tz_view(r, pl));
  end if;

  if r.status = 'expired' then return json_build_object('ok', false, 'reason', 'expired'); end if;
  if r.status = 'cancelled' then return json_build_object('ok', false, 'reason', 'cancelled'); end if;
  if r.status = 'playing' then return json_build_object('ok', false, 'reason', 'started'); end if;
  if r.status = 'finished' then return json_build_object('ok', false, 'reason', 'finished'); end if;
  if (select count(*) from public.tz_players where room_id = rid) >= r.max_players then
    return json_build_object('ok', false, 'reason', 'full');
  end if;

  -- one battle at a time: not in another team room, not in a Friend Zone room
  for mine in select distinct r2.id from public.tz_rooms r2 join public.tz_players p on p.room_id = r2.id
               where r2.status in ('waiting', 'playing') and r2.id <> rid
                 and not p.left_game
                 and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
  loop
    other := public.tz_settle(mine.id);
    if other.status in ('waiting', 'playing') then return json_build_object('ok', false, 'reason', 'busy', 'room_id', other.id); end if;
  end loop;
  if public.tz_friend_busy(a.uid, p_pid, a.h) is not null then return json_build_object('ok', false, 'reason', 'busy_friend'); end if;

  select * into ident from public.bt_identity(p_username, p_avatar);
  uname := ident.uname;
  -- two players can never show the same name in one room
  for i in 2..9 loop
    exit when not exists (select 1 from public.tz_players where room_id = rid and lower(username) = lower(uname));
    uname := left(ident.uname, 12) || '_' || i;
  end loop;

  select g into seat_no from generate_series(1, r.max_players) g
   where not exists (select 1 from public.tz_players p where p.room_id = rid and p.seat = g)
   order by g limit 1;

  insert into public.tz_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar)
  values (rid, seat_no, a.uid, case when a.uid is null then p_pid end, case when a.uid is null then a.h end, uname, ident.av)
  returning * into pl;
  update public.tz_players set is_ready = false where room_id = rid;     -- the roster changed: everyone readies again
  perform public.tz_bump(rid);
  select * into r from public.tz_rooms where id = rid;
  return json_build_object('ok', true, 'state', public.tz_view(r, pl));
end $$;

-- Heartbeat + poll + restore. Call every ~3 s and after a refresh. Returns my private view of the room.
create or replace function public.tz_sync(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; pl public.tz_players%rowtype;
begin
  pl := public.tz_mine(p_room, p_pid, p_secret);
  if pl.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.tz_players set last_seen = clock_timestamp() where id = pl.id;
  r := public.tz_settle(p_room);
  select * into pl from public.tz_players where id = pl.id;
  select * into r from public.tz_rooms where id = p_room;
  if pl.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true, 'state', public.tz_view(r, pl));
end $$;

-- Ready / not ready. When the room is full and everyone is ready and connected, the server starts the battle.
create or replace function public.tz_ready(p_room uuid, p_ready boolean, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; pl public.tz_players%rowtype; n int;
begin
  r := public.tz_settle(p_room);
  pl := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or pl.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status = 'waiting' then
    update public.tz_players set is_ready = coalesce(p_ready, false), last_seen = clock_timestamp() where id = pl.id;
    select count(*) into n from public.tz_players where room_id = r.id;
    if n = r.max_players and not exists (
         select 1 from public.tz_players p where p.room_id = r.id
            and (not p.is_ready or p.last_seen < clock_timestamp() - interval '15 seconds')) then
      perform public.tz_start(r.id);
    else
      perform public.tz_bump(r.id);
    end if;
  end if;
  select * into r from public.tz_rooms where id = p_room;
  select * into pl from public.tz_players where id = pl.id;
  return json_build_object('ok', r.status in ('waiting', 'playing'), 'reason', case when r.status in ('waiting', 'playing') then null else r.status end,
                           'state', public.tz_view(r, pl));
end $$;

-- Leave. Host in the lobby cancels the room for everyone. A guest leaves and the seat opens again.
create or replace function public.tz_leave(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; pl public.tz_players%rowtype;
begin
  r := public.tz_settle(p_room);
  pl := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or pl.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'waiting' then return json_build_object('ok', false, 'reason', 'not_in_lobby'); end if;
  if pl.seat = 1 then
    update public.tz_rooms set status = 'cancelled' where id = r.id;
    perform public.tz_bump(r.id);
  else
    delete from public.tz_players where id = pl.id;
    update public.tz_players set is_ready = false where room_id = r.id;
    perform public.tz_bump(r.id);
  end if;
  return json_build_object('ok', true, 'left', true);
end $$;

-- After a refresh or a reopened app: is there a team room I am still in?
create or replace function public.tz_get_active(p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; m record; r public.tz_rooms%rowtype;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  for m in select distinct r2.id from public.tz_rooms r2 join public.tz_players p on p.room_id = r2.id
            where r2.status in ('waiting', 'playing')
              and not p.left_game
              and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
  loop
    r := public.tz_settle(m.id);
    if r.status in ('waiting', 'playing') then return json_build_object('ok', true, 'active', json_build_object('room_id', r.id, 'status', r.status)); end if;
  end loop;
  return json_build_object('ok', true, 'active', null);
end $$;

revoke all on function public.tz_notify(uuid, int) from public, anon, authenticated;
revoke all on function public.tz_bump(uuid) from public, anon, authenticated;
revoke all on function public.tz_mine(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tz_friend_busy(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tz_settle(uuid) from public, anon, authenticated;
revoke all on function public.tz_view(public.tz_rooms, public.tz_players) from public, anon, authenticated;
revoke all on function public.tz_start(uuid) from public, anon, authenticated;
revoke all on function public.tz_cleanup() from public, anon, authenticated;

revoke all on function public.tz_create(text, int, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.tz_join(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.tz_sync(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tz_ready(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.tz_leave(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tz_get_active(uuid, text) from public, anon, authenticated;
grant execute on function public.tz_create(text, int, uuid, text, text, text) to anon, authenticated;
grant execute on function public.tz_join(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.tz_sync(uuid, uuid, text) to anon, authenticated;
grant execute on function public.tz_ready(uuid, boolean, uuid, text) to anon, authenticated;
grant execute on function public.tz_leave(uuid, uuid, text) to anon, authenticated;
grant execute on function public.tz_get_active(uuid, text) to anon, authenticated;
