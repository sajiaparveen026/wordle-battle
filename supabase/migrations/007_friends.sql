-- Wordle Battle: Friends system (friend requests, friend list, battle invitations, notifications).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Run it AFTER 005_leaderboard.sql and 006_friend_battle.sql (it reads the leaderboard and creates battle rooms).
--
-- WHO IS A "PLAYER"?  No new identity system. A player id is the id the app already uses:
--   * registered player -> their auth user id (the same id as profiles.id)
--   * guest             -> the guest id the device already keeps for the leaderboard and Friend Battle
--                          (localStorage key "wbid_lb_guest": a random id + a secret; only a hash of the secret is stored)
--   Names, avatars, level and XP are NOT copied: they are read from profiles / leaderboard when needed.
--
-- HOW IT IS PROTECTED (same model as 005 and 006)
--  * Every table has Row Level Security ON, no policies and no grants: a browser can never read or write them directly,
--    so nobody can read or change another player's requests, friends, invitations or notifications.
--  * The only doors are the fr_* functions below. Each one first works out WHO is calling (signed-in account, or guest
--    id + secret), then checks that the row being touched really belongs to that caller, then decides everything.
--  * Other players' ids (and any email) never leave the database. The app only ever sees names, avatars, level, XP and
--    opaque row ids of requests / friendships / invitations (which are useless unless you are the one they belong to).
--  * Live updates use Supabase Realtime BROADCAST (like the battles): when something changes for a player, the database
--    sends an empty "tick" on the channel `social:<player id>`, and the app then asks fr_overview for its own private view.
--
-- ONLINE STATUS: each open copy of the app calls fr_ping every ~25 s. A player counts as Online for 75 s after the last ping.
--
-- TIMING: there is no always-on job. Invitations that ran out are marked 'expired' the next time either player asks.
--
-- HONEST LIMIT: a guest's identity is the secret kept in this browser. Clearing browser data or switching device
-- loses that guest (and their friends). Creating an account moves the friends over (fr_adopt_guest).

-- ---------------------------------------------------------------- presence (who is online + who owns a guest id)
create table if not exists public.friend_presence (
  player_id      uuid primary key,                                              -- account: = user_id | guest: the guest id
  user_id        uuid unique references auth.users(id) on delete cascade,       -- set for registered players
  guest_key_hash text,                                                          -- sha256 of the guest's secret (never shown)
  username       text,                                                          -- guests only: last name the device reported
  avatar         text,
  last_seen      timestamptz not null default now(),
  merged_into    uuid,                                                          -- a guest that became an account
  created_at     timestamptz not null default now(),
  constraint fp_owner check ((user_id is not null and guest_key_hash is null and player_id = user_id)
                          or (user_id is null and guest_key_hash is not null)),
  constraint fp_name check (username is null or username ~ '^[A-Za-z0-9_]{3,16}$'),
  constraint fp_avatar check (avatar is null or char_length(avatar) between 1 and 8)
);
alter table public.friend_presence enable row level security;
revoke all on public.friend_presence from public, anon, authenticated;

-- ---------------------------------------------------------------- friendships (one row per pair, smaller id first)
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  player_one_id uuid not null,
  player_two_id uuid not null,
  status        text not null default 'accepted' check (status in ('accepted')),
  created_at    timestamptz not null default now(),
  constraint fs_order check (player_one_id < player_two_id),                     -- also rules out "friends with yourself"
  constraint fs_pair  unique (player_one_id, player_two_id)                      -- no duplicate friendships, ever
);
create index if not exists fs_two_idx on public.friendships (player_two_id);
alter table public.friendships enable row level security;
revoke all on public.friendships from public, anon, authenticated;

-- ---------------------------------------------------------------- friend requests
create table if not exists public.friend_requests (
  id             uuid primary key default gen_random_uuid(),
  sender_id      uuid not null,
  receiver_id    uuid not null,
  status         text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at     timestamptz not null default now(),
  responded_at   timestamptz,
  source_room_id uuid references public.battle_rooms(id) on delete set null,     -- the battle the request was sent from
  constraint fr_not_self check (sender_id <> receiver_id)
);
-- only ONE open request between two players, in either direction (no duplicates, no crossed requests)
create unique index if not exists fr_one_pending on public.friend_requests (least(sender_id, receiver_id), greatest(sender_id, receiver_id)) where status = 'pending';
create index if not exists fr_recv_idx on public.friend_requests (receiver_id, status);
create index if not exists fr_send_idx on public.friend_requests (sender_id, created_at);
alter table public.friend_requests enable row level security;
revoke all on public.friend_requests from public, anon, authenticated;

-- ---------------------------------------------------------------- battle invitations (separate from friend requests)
create table if not exists public.battle_invitations (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null,
  receiver_id  uuid not null,
  difficulty   text not null check (difficulty in ('easy','medium','hard')),
  status       text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  responded_at timestamptz,
  room_id      uuid references public.battle_rooms(id) on delete set null,       -- the private room created when it is accepted
  constraint bi_not_self check (sender_id <> receiver_id)
);
create unique index if not exists bi_one_pending on public.battle_invitations (sender_id, receiver_id) where status = 'pending';
create index if not exists bi_recv_idx on public.battle_invitations (receiver_id, status);
alter table public.battle_invitations enable row level security;
revoke all on public.battle_invitations from public, anon, authenticated;

-- ---------------------------------------------------------------- notifications
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  receiver_id uuid not null,
  type        text not null check (type in ('friend_request','friend_accepted','battle_invite','invite_accepted','invite_declined')),
  related_id  uuid not null,                                                     -- the friend request / battle invitation it is about
  is_read     boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint nt_once unique (receiver_id, type, related_id)                      -- the same event can never notify twice
);
create index if not exists nt_recv_idx on public.notifications (receiver_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;

-- ================================================================ internal helpers (not callable from the app)

-- Who is calling? Accounts: auth.uid(). Guests: id + secret, bound to the id the first time it is seen.
create or replace function public.fr_actor(p_pid uuid, p_secret text, out o_pid uuid, out o_h text, out o_ok boolean, out o_reason text) returns record
language plpgsql security definer set search_path = '' as $$
declare fp public.friend_presence%rowtype;
begin
  o_ok := false;
  if auth.uid() is not null then o_pid := auth.uid(); o_ok := true; return; end if;
  if p_pid is null or p_secret is null or char_length(p_secret) < 24 or char_length(p_secret) > 100 then o_reason := 'bad_id'; return; end if;
  o_h := encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
  select * into fp from public.friend_presence where player_id = p_pid;
  if not found then
    -- a guest id that is already taken by someone else (it is visible on the leaderboard) cannot be claimed here
    if exists (select 1 from public.profiles where id = p_pid)
       or exists (select 1 from public.leaderboard l where l.pid = p_pid and (l.user_id is not null or l.guest_key_hash is distinct from o_h))
       or exists (select 1 from public.battle_players b where b.guest_pid = p_pid and b.key_hash is distinct from o_h) then
      o_reason := 'forbidden'; return;
    end if;
    insert into public.friend_presence (player_id, guest_key_hash) values (p_pid, o_h) on conflict (player_id) do nothing;
    select * into fp from public.friend_presence where player_id = p_pid;
  end if;
  if fp.user_id is not null or fp.guest_key_hash is distinct from o_h then o_reason := 'forbidden'; return; end if;
  if fp.merged_into is not null then o_reason := 'merged'; return; end if;
  o_pid := p_pid; o_ok := true;
end $$;

-- Public facts about a player: name, avatar, level, XP (nothing private).
create or replace function public.fr_card(p_player uuid, out uname text, out av text, out lv int, out xpv int, out is_guest boolean) returns record
language plpgsql security definer stable set search_path = '' as $$
begin
  is_guest := true;
  select p.username, p.avatar into uname, av from public.profiles p where p.id = p_player;
  if found then
    is_guest := false;
    select l.level, l.xp into lv, xpv from public.leaderboard l where l.user_id = p_player;
  else
    select l.username, l.avatar, l.level, l.xp into uname, av, lv, xpv from public.leaderboard l where l.pid = p_player and l.user_id is null;
    if uname is null then select f.username, f.avatar into uname, av from public.friend_presence f where f.player_id = p_player; end if;
    if uname is null then select b.username, b.avatar into uname, av from public.battle_players b where b.guest_pid = p_player order by b.created_at desc limit 1; end if;
  end if;
  uname := coalesce(uname, 'Player'); av := coalesce(av, '🦊'); lv := coalesce(lv, 1); xpv := coalesce(xpv, 0);
end $$;

create or replace function public.fr_online(p_player uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.friend_presence where player_id = p_player and last_seen > clock_timestamp() - interval '75 seconds');
$$;

create or replace function public.fr_are_friends(p_a uuid, p_b uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.friendships where player_one_id = least(p_a, p_b) and player_two_id = greatest(p_a, p_b));
$$;

-- A guest id that became an account points at the account.
create or replace function public.fr_resolve(p_player uuid) returns uuid
language sql security definer stable set search_path = '' as $$
  select coalesce((select merged_into from public.friend_presence where player_id = p_player), p_player);
$$;

-- Tell a player "something changed" (empty tick, no data). Never fails the caller.
create or replace function public.fr_notify(p_player uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('t', (extract(epoch from clock_timestamp()) * 1000)::bigint), 'tick', 'social:' || p_player::text, false);
exception when others then null;
end $$;

-- Invitations that ran out of time become 'expired' (and their notification stops offering Accept).
create or replace function public.fr_expire(p_player uuid) returns void
language sql security definer set search_path = '' as $$
  update public.battle_invitations set status = 'expired', responded_at = clock_timestamp()
   where status = 'pending' and expires_at < clock_timestamp() and (sender_id = p_player or receiver_id = p_player);
$$;

-- Is this player in a battle room that is still alive? (settles rooms that have run out first)
create or replace function public.fr_in_room(p_player uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  for m in select distinct r.id from public.battle_rooms r join public.battle_players p on p.room_id = r.id
            where r.status in ('waiting', 'lobby', 'playing') and (p.user_id = p_player or p.guest_pid = p_player)
  loop
    if (public.bt_settle(m.id)).status in ('waiting', 'lobby', 'playing') then return m.id; end if;
  end loop;
  return null;
end $$;

-- Put a player into a battle room (name + avatar come from their profile / leaderboard entry, like bt_identity).
create or replace function public.fr_seat(p_room uuid, p_seat int, p_player uuid, p_avoid text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c record; acct boolean; h text; nm text;
begin
  select * into c from public.fr_card(p_player);
  acct := exists (select 1 from public.profiles where id = p_player);
  if not acct then select guest_key_hash into h from public.friend_presence where player_id = p_player and user_id is null; end if;
  nm := c.uname;
  if p_avoid is not null and lower(p_avoid) = lower(nm) then nm := left(nm, 13) || '_2'; end if;
  insert into public.battle_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar)
  values (p_room, p_seat, case when acct then p_player end, case when not acct then p_player end, case when not acct then h end, nm, c.av);
end $$;

-- Accept a pending friend request (caller has already checked it is theirs): both players become friends, the sender is told.
create or replace function public.fr_accept_core(p_req uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare rq public.friend_requests%rowtype;
begin
  select * into rq from public.friend_requests where id = p_req and status = 'pending' for update;
  if not found then return; end if;
  insert into public.friendships (player_one_id, player_two_id)
  values (least(rq.sender_id, rq.receiver_id), greatest(rq.sender_id, rq.receiver_id)) on conflict do nothing;
  update public.friend_requests set status = 'accepted', responded_at = clock_timestamp() where id = rq.id;
  update public.notifications set is_read = true where receiver_id = rq.receiver_id and type = 'friend_request' and related_id = rq.id;
  insert into public.notifications (receiver_id, type, related_id) values (rq.sender_id, 'friend_accepted', rq.id) on conflict do nothing;
  perform public.fr_notify(rq.sender_id);
  perform public.fr_notify(rq.receiver_id);
end $$;

-- Occasional tidy-up (called from fr_ping): old answered requests / invitations / read notifications.
create or replace function public.fr_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.friend_requests where status <> 'pending' and coalesce(responded_at, created_at) < now() - interval '30 days';
  delete from public.battle_invitations where status <> 'pending' and coalesce(responded_at, created_at) < now() - interval '2 days';
  delete from public.battle_invitations where status = 'pending' and expires_at < now() - interval '2 days';
  delete from public.notifications where is_read and created_at < now() - interval '30 days';
  delete from public.notifications where created_at < now() - interval '90 days';
end $$;

revoke all on function public.fr_actor(uuid, text) from public, anon, authenticated;
revoke all on function public.fr_card(uuid) from public, anon, authenticated;
revoke all on function public.fr_online(uuid) from public, anon, authenticated;
revoke all on function public.fr_are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fr_resolve(uuid) from public, anon, authenticated;
revoke all on function public.fr_notify(uuid) from public, anon, authenticated;
revoke all on function public.fr_expire(uuid) from public, anon, authenticated;
revoke all on function public.fr_in_room(uuid) from public, anon, authenticated;
revoke all on function public.fr_seat(uuid, int, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_accept_core(uuid) from public, anon, authenticated;
revoke all on function public.fr_cleanup() from public, anon, authenticated;

-- ================================================================ public doors (these are what the app calls)
-- Every function takes the guest's id + secret (p_pid, p_secret); signed-in accounts leave them empty.

-- Heartbeat: "I'm here" (online status) + the name a guest currently uses. Call every ~25 s while the app is open.
create or replace function public.fr_ping(p_username text default null, p_avatar text default null, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  if auth.uid() is not null then
    insert into public.friend_presence (player_id, user_id, last_seen) values (a.o_pid, a.o_pid, clock_timestamp())
    on conflict (player_id) do update set last_seen = clock_timestamp();
  else
    update public.friend_presence
       set last_seen = clock_timestamp(),
           username = case when p_username is not null and p_username ~ '^[A-Za-z0-9_]{3,16}$' then p_username else username end,
           avatar   = case when p_avatar is not null and char_length(p_avatar) between 1 and 8 then p_avatar else avatar end
     where player_id = a.o_pid;
  end if;
  if random() < 0.01 then perform public.fr_cleanup(); end if;
  return json_build_object('ok', true, 'me', a.o_pid);
end $$;

-- Everything the Friends page and the notification badge need, in one private view.
create or replace function public.fr_overview(p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; fl json; inc json; outg json; iin json; iout json; nt json; unread int;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  perform public.fr_expire(me);

  select coalesce(json_agg(t order by t.online desc, lower(t.name)), '[]'::json) into fl from (
    select f.id as fid, c.uname as name, c.av as avatar, c.lv as level, c.xpv as xp, c.is_guest as guest,
           public.fr_online(o.pid) as online, f.created_at
      from public.friendships f
      cross join lateral (select case when f.player_one_id = me then f.player_two_id else f.player_one_id end as pid) o
      cross join lateral public.fr_card(o.pid) c
     where f.player_one_id = me or f.player_two_id = me) t;

  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into inc from (
    select r.id as rid, c.uname as name, c.av as avatar, c.lv as level, c.xpv as xp, r.created_at
      from public.friend_requests r cross join lateral public.fr_card(r.sender_id) c
     where r.receiver_id = me and r.status = 'pending') t;

  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into outg from (
    select r.id as rid, c.uname as name, c.av as avatar, c.lv as level, c.xpv as xp, r.created_at
      from public.friend_requests r cross join lateral public.fr_card(r.receiver_id) c
     where r.sender_id = me and r.status = 'pending') t;

  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into iin from (
    select i.id as iid, c.uname as name, c.av as avatar, c.lv as level, i.difficulty, i.created_at,
           (extract(epoch from (i.expires_at - clock_timestamp())) * 1000)::bigint as expires_in_ms
      from public.battle_invitations i cross join lateral public.fr_card(i.sender_id) c
     where i.receiver_id = me and i.status = 'pending' and i.expires_at > clock_timestamp()) t;

  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into iout from (
    select i.id as iid, c.uname as name, c.av as avatar, i.difficulty, i.created_at,
           (select f.id from public.friendships f where f.player_one_id = least(me, i.receiver_id) and f.player_two_id = greatest(me, i.receiver_id)) as fid,
           (extract(epoch from (i.expires_at - clock_timestamp())) * 1000)::bigint as expires_in_ms
      from public.battle_invitations i cross join lateral public.fr_card(i.receiver_id) c
     where i.sender_id = me and i.status = 'pending' and i.expires_at > clock_timestamp()) t;

  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into nt from (
    select n.id as nid, n.type, n.related_id, n.is_read, n.created_at, c.uname as name, c.av as avatar,
           i.status as inv_status, i.difficulty, i.room_id, r.status as req_status
      from public.notifications n
      left join public.friend_requests r on r.id = n.related_id and n.type in ('friend_request', 'friend_accepted')
      left join public.battle_invitations i on i.id = n.related_id and n.type in ('battle_invite', 'invite_accepted', 'invite_declined')
      cross join lateral (select case n.type when 'friend_request' then r.sender_id when 'friend_accepted' then r.receiver_id
                                             when 'battle_invite' then i.sender_id else i.receiver_id end as pid) o
      cross join lateral public.fr_card(o.pid) c
     where n.receiver_id = me and o.pid is not null
     order by n.created_at desc limit 40) t;

  select count(*) into unread from public.notifications where receiver_id = me and not is_read;

  return json_build_object('ok', true, 'me', me, 'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'friends', fl, 'incoming', inc, 'outgoing', outg, 'inv_in', iin, 'inv_out', iout, 'notifs', nt, 'unread', unread);
end $$;

-- The "+ Add Friend" button on the battle result: the SERVER finds the opponent from the finished battle, so the app never needs
-- (or learns) their id, and nobody can send requests to players they have not fought.
create or replace function public.fr_send_request(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; mine public.battle_players%rowtype; opp public.battle_players%rowtype; rs text; other uuid; rid uuid; rq public.friend_requests%rowtype;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  mine := public.bt_mine(p_room, p_pid, p_secret);
  if mine.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  select status into rs from public.battle_rooms where id = p_room;
  if rs is distinct from 'finished' then return json_build_object('ok', false, 'reason', 'not_finished'); end if;
  select * into opp from public.battle_players where room_id = p_room and id <> mine.id;
  if not found then return json_build_object('ok', false, 'reason', 'no_opponent'); end if;
  other := public.fr_resolve(coalesce(opp.user_id, opp.guest_pid));
  if other is null or other = me then return json_build_object('ok', false, 'reason', 'self'); end if;

  if public.fr_are_friends(me, other) then return json_build_object('ok', true, 'status', 'friends'); end if;
  if exists (select 1 from public.friend_requests where sender_id = me and receiver_id = other and status = 'pending') then
    return json_build_object('ok', true, 'status', 'sent');                           -- already asked: never a second request
  end if;
  select * into rq from public.friend_requests where sender_id = other and receiver_id = me and status = 'pending' for update;
  if found then                                                                          -- they already asked me: that is a yes from both sides
    perform public.fr_accept_core(rq.id);
    return json_build_object('ok', true, 'status', 'friends', 'auto', true);
  end if;
  if (select count(*) from public.friend_requests where sender_id = me and created_at > now() - interval '1 hour') >= 20 then
    return json_build_object('ok', false, 'reason', 'throttled');
  end if;
  if (select count(*) from public.friendships where player_one_id = me or player_two_id = me) >= 200 then
    return json_build_object('ok', false, 'reason', 'friend_limit');
  end if;
  if (select count(*) from public.friend_requests where sender_id = me and status = 'pending') >= 50 then
    return json_build_object('ok', false, 'reason', 'too_many_pending');
  end if;

  begin
    insert into public.friend_requests (sender_id, receiver_id, source_room_id) values (me, other, p_room) returning id into rid;
  exception when unique_violation then
    return json_build_object('ok', true, 'status', 'sent');
  end;
  insert into public.notifications (receiver_id, type, related_id) values (other, 'friend_request', rid) on conflict do nothing;
  perform public.fr_notify(other);
  perform public.fr_notify(me);
  return json_build_object('ok', true, 'status', 'sent');
end $$;

-- What is my relationship with the opponent of this finished battle? (so the result screen shows the right button)
create or replace function public.fr_relation(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; mine public.battle_players%rowtype; opp public.battle_players%rowtype; other uuid; st text;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  mine := public.bt_mine(p_room, p_pid, p_secret);
  if mine.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into opp from public.battle_players where room_id = p_room and id <> mine.id;
  if not found then return json_build_object('ok', false, 'reason', 'no_opponent'); end if;
  other := public.fr_resolve(coalesce(opp.user_id, opp.guest_pid));
  st := case
          when other = me then 'self'
          when public.fr_are_friends(me, other) then 'friends'
          when exists (select 1 from public.friend_requests where sender_id = me and receiver_id = other and status = 'pending') then 'sent'
          when exists (select 1 from public.friend_requests where sender_id = other and receiver_id = me and status = 'pending') then 'incoming'
          else 'none' end;
  return json_build_object('ok', true, 'status', st);
end $$;

-- Accept or decline an incoming friend request.
create or replace function public.fr_respond_request(p_request uuid, p_accept boolean, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; rq public.friend_requests%rowtype;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  select * into rq from public.friend_requests where id = p_request and receiver_id = me for update;   -- only the receiver can answer
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if rq.status <> 'pending' then return json_build_object('ok', false, 'reason', 'not_pending', 'status', rq.status); end if;
  if coalesce(p_accept, false) then
    if (select count(*) from public.friendships where player_one_id = me or player_two_id = me) >= 200 then
      return json_build_object('ok', false, 'reason', 'friend_limit');
    end if;
    perform public.fr_accept_core(rq.id);
    return json_build_object('ok', true, 'status', 'accepted');
  end if;
  update public.friend_requests set status = 'declined', responded_at = clock_timestamp() where id = rq.id;
  update public.notifications set is_read = true where receiver_id = me and type = 'friend_request' and related_id = rq.id;
  perform public.fr_notify(me);
  return json_build_object('ok', true, 'status', 'declined');
end $$;

-- Cancel a request I sent (it disappears from their list too).
create or replace function public.fr_cancel_request(p_request uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; rq public.friend_requests%rowtype;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  select * into rq from public.friend_requests where id = p_request and sender_id = me for update;     -- only the sender can cancel
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if rq.status <> 'pending' then return json_build_object('ok', false, 'reason', 'not_pending', 'status', rq.status); end if;
  update public.friend_requests set status = 'cancelled', responded_at = clock_timestamp() where id = rq.id;
  delete from public.notifications where receiver_id = rq.receiver_id and type = 'friend_request' and related_id = rq.id;
  perform public.fr_notify(rq.receiver_id);
  perform public.fr_notify(me);
  return json_build_object('ok', true, 'status', 'cancelled');
end $$;

-- Remove a friend (both lists update; open battle invitations between the two are cancelled).
create or replace function public.fr_remove_friend(p_friendship uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; fs public.friendships%rowtype; other uuid;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  select * into fs from public.friendships where id = p_friendship and (player_one_id = me or player_two_id = me) for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  other := case when fs.player_one_id = me then fs.player_two_id else fs.player_one_id end;
  delete from public.friendships where id = fs.id;
  update public.battle_invitations set status = 'cancelled', responded_at = clock_timestamp()
   where status = 'pending' and ((sender_id = me and receiver_id = other) or (sender_id = other and receiver_id = me));
  perform public.fr_notify(other);
  perform public.fr_notify(me);
  return json_build_object('ok', true);
end $$;

-- Invite a friend to a battle. The sender picks the difficulty. Valid for 5 minutes. No room code is involved.
create or replace function public.fr_invite(p_friendship uuid, p_difficulty text, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; fs public.friendships%rowtype; other uuid; iid uuid; busy uuid;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  if p_difficulty is null or p_difficulty not in ('easy', 'medium', 'hard') then return json_build_object('ok', false, 'reason', 'bad_difficulty'); end if;
  select * into fs from public.friendships where id = p_friendship and (player_one_id = me or player_two_id = me);
  if not found then return json_build_object('ok', false, 'reason', 'not_friends'); end if;
  other := case when fs.player_one_id = me then fs.player_two_id else fs.player_one_id end;
  perform public.fr_expire(me);
  if exists (select 1 from public.battle_invitations where sender_id = me and receiver_id = other and status = 'pending') then
    return json_build_object('ok', false, 'reason', 'already_invited');
  end if;
  if (select count(*) from public.battle_invitations where sender_id = me and created_at > now() - interval '1 minute') >= 5 then
    return json_build_object('ok', false, 'reason', 'throttled');
  end if;
  busy := public.fr_in_room(me);
  if busy is not null then return json_build_object('ok', false, 'reason', 'busy', 'room_id', busy); end if;
  begin
    insert into public.battle_invitations (sender_id, receiver_id, difficulty, expires_at)
    values (me, other, p_difficulty, now() + interval '5 minutes') returning id into iid;
  exception when unique_violation then
    return json_build_object('ok', false, 'reason', 'already_invited');
  end;
  insert into public.notifications (receiver_id, type, related_id) values (other, 'battle_invite', iid) on conflict do nothing;
  perform public.fr_notify(other);
  perform public.fr_notify(me);
  return json_build_object('ok', true, 'invite_id', iid);
end $$;

-- Withdraw an invitation I sent.
create or replace function public.fr_cancel_invite(p_invite uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; iv public.battle_invitations%rowtype;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  select * into iv from public.battle_invitations where id = p_invite and sender_id = me for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if iv.status <> 'pending' then return json_build_object('ok', false, 'reason', 'not_pending', 'status', iv.status); end if;
  update public.battle_invitations set status = 'cancelled', responded_at = clock_timestamp() where id = iv.id;
  delete from public.notifications where receiver_id = iv.receiver_id and type = 'battle_invite' and related_id = iv.id;
  perform public.fr_notify(iv.receiver_id);
  perform public.fr_notify(me);
  return json_build_object('ok', true, 'status', 'cancelled');
end $$;

-- Accept or decline a battle invitation. Accepting creates the private room (both players seated, in the lobby) and
-- returns it; the sender is told and joins the same room. It never touches friendships or friend requests.
create or replace function public.fr_respond_invite(p_invite uuid, p_accept boolean, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; iv public.battle_invitations%rowtype; rid uuid; code text; secs int; i int; tries int := 0; s_name text;
        sender_busy uuid; my_busy uuid; r public.battle_rooms%rowtype; pl public.battle_players%rowtype;
        alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  select * into iv from public.battle_invitations where id = p_invite and receiver_id = me for update;      -- only the receiver can answer
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if iv.status <> 'pending' then return json_build_object('ok', false, 'reason', case when iv.status = 'expired' then 'expired' else 'not_pending' end, 'status', iv.status); end if;
  if iv.expires_at < clock_timestamp() then
    update public.battle_invitations set status = 'expired', responded_at = clock_timestamp() where id = iv.id;
    perform public.fr_notify(me);
    return json_build_object('ok', false, 'reason', 'expired');
  end if;

  if not coalesce(p_accept, false) then
    update public.battle_invitations set status = 'declined', responded_at = clock_timestamp() where id = iv.id;
    update public.notifications set is_read = true where receiver_id = me and type = 'battle_invite' and related_id = iv.id;
    insert into public.notifications (receiver_id, type, related_id) values (iv.sender_id, 'invite_declined', iv.id) on conflict do nothing;
    perform public.fr_notify(iv.sender_id);
    perform public.fr_notify(me);
    return json_build_object('ok', true, 'status', 'declined');
  end if;

  -- accepting: still friends? sender still here? nobody already in another battle?
  if not public.fr_are_friends(me, iv.sender_id) then
    update public.battle_invitations set status = 'cancelled', responded_at = clock_timestamp() where id = iv.id;
    return json_build_object('ok', false, 'reason', 'not_friends');
  end if;
  if not public.fr_online(iv.sender_id) then
    update public.battle_invitations set status = 'expired', responded_at = clock_timestamp() where id = iv.id;
    perform public.fr_notify(iv.sender_id);
    return json_build_object('ok', false, 'reason', 'sender_away');
  end if;
  my_busy := public.fr_in_room(me);
  if my_busy is not null then return json_build_object('ok', false, 'reason', 'busy', 'room_id', my_busy); end if;
  sender_busy := public.fr_in_room(iv.sender_id);
  if sender_busy is not null then return json_build_object('ok', false, 'reason', 'sender_busy'); end if;

  secs := case iv.difficulty when 'easy' then 720 when 'medium' then 480 else 300 end;
  loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
    begin
      insert into public.battle_rooms (room_code, host_user_id, host_guest_pid, difficulty, duration_seconds, status, expires_at)
      values (code,
              case when exists (select 1 from public.profiles where id = iv.sender_id) then iv.sender_id end,
              case when not exists (select 1 from public.profiles where id = iv.sender_id) then iv.sender_id end,
              iv.difficulty, secs, 'lobby', now() + interval '10 minutes')
      returning id into rid;
      exit;
    exception when unique_violation then
      tries := tries + 1; if tries > 20 then return json_build_object('ok', false, 'reason', 'try_again'); end if;
    end;
  end loop;
  perform public.fr_seat(rid, 1, iv.sender_id);
  select username into s_name from public.battle_players where room_id = rid and seat = 1;
  perform public.fr_seat(rid, 2, me, s_name);
  update public.battle_invitations set status = 'accepted', responded_at = clock_timestamp(), room_id = rid where id = iv.id;
  update public.notifications set is_read = true where receiver_id = me and type = 'battle_invite' and related_id = iv.id;
  insert into public.notifications (receiver_id, type, related_id) values (iv.sender_id, 'invite_accepted', iv.id) on conflict do nothing;
  perform public.bt_bump(rid);
  perform public.fr_notify(iv.sender_id);
  perform public.fr_notify(me);
  select * into r from public.battle_rooms where id = rid;
  select * into pl from public.battle_players where room_id = rid and seat = 2;
  return json_build_object('ok', true, 'status', 'accepted', 'room_id', rid, 'state', public.bt_view(r, pl));
end $$;

-- Mark notifications as read (all of mine, or just the listed ones).
create or replace function public.fr_mark_read(p_ids uuid[] default null, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; n int;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  update public.notifications set is_read = true where receiver_id = a.o_pid and not is_read and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'marked', n);
end $$;

-- A guest just created an account: move this guest's friends, requests, invitations and notifications onto the account.
-- Never creates a duplicate friend; anything that would clash is dropped. Safe to repeat.
create or replace function public.fr_adopt_guest(p_guest uuid, p_secret text) returns json
language plpgsql security definer set search_path = '' as $$
declare acct uuid := auth.uid(); h text; g public.friend_presence%rowtype; f record; rq record; o uuid; s uuid; rc uuid; moved int := 0; ps uuid[];
begin
  if acct is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_guest is null or p_secret is null or char_length(p_secret) < 24 or char_length(p_secret) > 100 then return json_build_object('ok', false); end if;
  h := encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
  select * into g from public.friend_presence where player_id = p_guest and user_id is null and guest_key_hash = h for update;
  if not found then return json_build_object('ok', true, 'moved', 0); end if;
  if g.merged_into is not null or p_guest = acct then return json_build_object('ok', true, 'moved', 0); end if;

  -- anything between the guest and this very account would become "myself": drop it
  delete from public.friendships where player_one_id = least(p_guest, acct) and player_two_id = greatest(p_guest, acct);
  delete from public.friend_requests where (sender_id = p_guest and receiver_id = acct) or (sender_id = acct and receiver_id = p_guest);
  delete from public.battle_invitations where (sender_id = p_guest and receiver_id = acct) or (sender_id = acct and receiver_id = p_guest);

  -- friendships: re-point, skipping anyone the account is already friends with
  for f in select * from public.friendships where player_one_id = p_guest or player_two_id = p_guest loop
    o := case when f.player_one_id = p_guest then f.player_two_id else f.player_one_id end;
    if exists (select 1 from public.friendships x where x.player_one_id = least(acct, o) and x.player_two_id = greatest(acct, o)) then
      delete from public.friendships where id = f.id;
    else
      update public.friendships set player_one_id = least(acct, o), player_two_id = greatest(acct, o) where id = f.id;
      moved := moved + 1;
    end if;
  end loop;

  -- pending requests: re-point unless they would duplicate / contradict something the account already has
  for rq in select * from public.friend_requests where status = 'pending' and (sender_id = p_guest or receiver_id = p_guest) loop
    s := case when rq.sender_id = p_guest then acct else rq.sender_id end;
    rc := case when rq.receiver_id = p_guest then acct else rq.receiver_id end;
    if s = rc or public.fr_are_friends(s, rc)
       or exists (select 1 from public.friend_requests x where x.status = 'pending' and x.id <> rq.id and least(x.sender_id, x.receiver_id) = least(s, rc) and greatest(x.sender_id, x.receiver_id) = greatest(s, rc)) then
      update public.friend_requests set status = 'cancelled', responded_at = clock_timestamp() where id = rq.id;
      delete from public.notifications where related_id = rq.id and type = 'friend_request';
    else
      update public.friend_requests set sender_id = s, receiver_id = rc where id = rq.id;
      moved := moved + 1;
    end if;
  end loop;
  update public.friend_requests set sender_id = acct where sender_id = p_guest;        -- old answered ones: history only
  update public.friend_requests set receiver_id = acct where receiver_id = p_guest;

  -- invitations are short-lived: open ones are cancelled, the rest follow the account
  update public.battle_invitations set status = 'cancelled', responded_at = clock_timestamp()
   where status = 'pending' and (sender_id = p_guest or receiver_id = p_guest);
  update public.battle_invitations set sender_id = acct where sender_id = p_guest;
  update public.battle_invitations set receiver_id = acct where receiver_id = p_guest;

  -- notifications follow the account (a duplicate of the same event is dropped)
  delete from public.notifications n where n.receiver_id = p_guest
     and exists (select 1 from public.notifications m where m.receiver_id = acct and m.type = n.type and m.related_id = n.related_id);
  update public.notifications set receiver_id = acct where receiver_id = p_guest;

  update public.friend_presence set merged_into = acct where player_id = p_guest;     -- the old guest id now points at the account
  perform public.fr_notify(acct);
  return json_build_object('ok', true, 'moved', moved);
end $$;

revoke all on function public.fr_ping(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_overview(uuid, text) from public, anon, authenticated;
revoke all on function public.fr_send_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_relation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_respond_request(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_cancel_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_remove_friend(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_invite(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_cancel_invite(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_respond_invite(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.fr_mark_read(uuid[], uuid, text) from public, anon, authenticated;
revoke all on function public.fr_adopt_guest(uuid, text) from public, anon, authenticated;

grant execute on function public.fr_ping(text, text, uuid, text) to anon, authenticated;
grant execute on function public.fr_overview(uuid, text) to anon, authenticated;
grant execute on function public.fr_send_request(uuid, uuid, text) to anon, authenticated;
grant execute on function public.fr_relation(uuid, uuid, text) to anon, authenticated;
grant execute on function public.fr_respond_request(uuid, boolean, uuid, text) to anon, authenticated;
grant execute on function public.fr_cancel_request(uuid, uuid, text) to anon, authenticated;
grant execute on function public.fr_remove_friend(uuid, uuid, text) to anon, authenticated;
grant execute on function public.fr_invite(uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.fr_cancel_invite(uuid, uuid, text) to anon, authenticated;
grant execute on function public.fr_respond_invite(uuid, boolean, uuid, text) to anon, authenticated;
grant execute on function public.fr_mark_read(uuid[], uuid, text) to anon, authenticated;
grant execute on function public.fr_adopt_guest(uuid, text) to authenticated;
