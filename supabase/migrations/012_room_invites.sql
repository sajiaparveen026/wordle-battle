-- Wordle Battle: invite friends straight into a waiting lobby (Friend Zone AND Team Zone).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Run it AFTER 006, 007, 009, 010 and 011 (it reads friends, notifications, Friend Zone rooms and Team Zone rooms).
--
-- WHAT IT ADDS
--  * room_invitations: "<host> invites <friend> to the room that is already open". Accepting seats the friend in THAT room,
--    so no room code is typed. (007's battle_invitations are different: they create a NEW room when accepted. They are untouched.)
--  * ri_friends / ri_send / ri_cancel / ri_respond: the only doors the app calls (same guest id + secret model as 007).
--  * Three new notification types, delivered through the existing notifications table and the existing live "tick".
--  * fr_overview is extended (not replaced in spirit): it now also returns the room invitations waiting for the caller.
--
-- HOW IT IS PROTECTED (same model as 005-011)
--  * room_invitations has Row Level Security ON, no policies, no grants: a browser can never touch it directly.
--  * Only the room's HOST can send / see the invite list; the SERVER re-checks host, room status and capacity on every call.
--  * The invited player must be a friend of the host, must not already be in another battle, and must still fit in the room.
--  * One invitation per friend per room (pending or declined blocks another one). Throttled to 10 invitations a minute.
--  * Invitations close by themselves when the room fills up, starts, is cancelled or expires (database triggers),
--    and anything left over is closed the next time either player asks (ri_expire).
--  * Nobody's player id is ever sent to the app: it only sees names, avatars, levels and opaque row ids.
--  * No service-role key is involved anywhere: everything runs as database functions the anon / authenticated roles may call.

-- ---------------------------------------------------------------- notification types
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.notifications'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%battle_invite%'
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.notifications add constraint notifications_type_check
  check (type in ('friend_request','friend_accepted','battle_invite','invite_accepted','invite_declined',
                  'room_invite','room_invite_accepted','room_invite_declined'));

-- ---------------------------------------------------------------- room invitations
create table if not exists public.room_invitations (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null,
  receiver_id  uuid not null,
  mode         text not null check (mode in ('friend','team')),
  bt_room_id   uuid references public.battle_rooms(id) on delete cascade,        -- Friend Zone room (mode = friend)
  tz_room_id   uuid references public.tz_rooms(id) on delete cascade,            -- Team Zone room   (mode = team)
  status       text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
  close_reason text check (close_reason in ('full','started','closed','timeout')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  responded_at timestamptz,
  constraint ri_not_self check (sender_id <> receiver_id),
  constraint ri_one_room check ((mode = 'friend' and bt_room_id is not null and tz_room_id is null)
                             or (mode = 'team'   and tz_room_id is not null and bt_room_id is null))
);
alter table public.room_invitations add column if not exists close_reason text;
-- a friend can be invited to a room only once while the invitation is open (or after they said no)
create unique index if not exists ri_once on public.room_invitations (coalesce(bt_room_id, tz_room_id), receiver_id) where status in ('pending', 'declined');
create index if not exists ri_recv_idx on public.room_invitations (receiver_id, status);
create index if not exists ri_send_idx on public.room_invitations (sender_id, created_at);
alter table public.room_invitations enable row level security;
revoke all on public.room_invitations from public, anon, authenticated;

-- ================================================================ internal helpers (not callable from the app)

-- Is this player in ANY battle room that is still alive (Friend Zone or Team Zone)? Cheap, read-only: for the friend list.
create or replace function public.ri_busy_fast(p_player uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.battle_players b join public.battle_rooms r on r.id = b.room_id
                  where r.status in ('waiting', 'lobby', 'playing') and (b.user_id = p_player or b.guest_pid = p_player))
      or exists (select 1 from public.tz_players q join public.tz_rooms z on z.id = q.room_id
                  where z.status in ('waiting', 'playing') and not q.left_game and (q.user_id = p_player or q.guest_pid = p_player));
$$;

-- Same question, strict: rooms that ran out of time are settled first. Returns the room the player is stuck in, or null.
create or replace function public.ri_busy(p_player uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m record; z public.tz_rooms%rowtype; b uuid;
begin
  b := public.fr_in_room(p_player);
  if b is not null then return b; end if;
  for m in select distinct q.room_id from public.tz_players q join public.tz_rooms r on r.id = q.room_id
            where r.status in ('waiting', 'playing') and not q.left_game and (q.user_id = p_player or q.guest_pid = p_player)
  loop
    z := public.tz_settle(m.room_id);
    if z.status in ('waiting', 'playing') then return z.id; end if;
  end loop;
  return null;
end $$;

-- Facts about a room, from the point of view of p_me: does it exist, is p_me its host, is it still open for invitations?
create or replace function public.ri_room(p_mode text, p_room uuid, p_me uuid,
                                          out o_found boolean, out o_host boolean, out o_status text, out o_count int, out o_cap int, out o_open boolean)
returns record language plpgsql security definer set search_path = '' as $$
declare b public.battle_rooms%rowtype; z public.tz_rooms%rowtype;
begin
  o_found := false; o_host := false; o_open := false;
  if p_room is null then return; end if;
  if p_mode = 'friend' then
    if not exists (select 1 from public.battle_rooms where id = p_room) then return; end if;
    b := public.bt_settle(p_room);                                   -- also locks the room, so two answers are handled one at a time
    o_found := true; o_status := b.status; o_cap := 2;
    select count(*) into o_count from public.battle_players where room_id = p_room;
    o_host := coalesce(b.host_user_id = p_me, false) or coalesce(b.host_guest_pid = p_me, false);
    o_open := (b.status = 'waiting' and o_count < 2);
  elsif p_mode = 'team' then
    if not exists (select 1 from public.tz_rooms where id = p_room) then return; end if;
    z := public.tz_settle(p_room);
    o_found := true; o_status := z.status; o_cap := z.max_players;
    select count(*) into o_count from public.tz_players where room_id = p_room and not left_game;
    o_host := coalesce(z.host_user_id = p_me, false) or coalesce(z.host_guest_pid = p_me, false);
    o_open := (z.status = 'waiting' and o_count < z.max_players);
  end if;
end $$;

-- Close invitations that can no longer be accepted (time ran out, or their room is no longer waiting for players).
create or replace function public.ri_expire(p_player uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.room_invitations i
     set status = 'expired', responded_at = clock_timestamp(),
         close_reason = case when i.expires_at < clock_timestamp() then 'timeout' else 'closed' end
   where i.status = 'pending' and (i.sender_id = p_player or i.receiver_id = p_player)
     and (i.expires_at < clock_timestamp()
          or (i.mode = 'friend' and not exists (select 1 from public.battle_rooms b where b.id = i.bt_room_id and b.status = 'waiting'))
          or (i.mode = 'team'   and not exists (select 1 from public.tz_rooms z where z.id = i.tz_room_id and z.status = 'waiting')));
  if random() < 0.02 then
    delete from public.room_invitations where status <> 'pending' and coalesce(responded_at, created_at) < now() - interval '2 days';
  end if;
end $$;

-- Triggers: the moment a room stops waiting for players (second player in, battle started, cancelled, expired), every open
-- invitation to it is closed and both sides are told. They can never break a room: any problem here is swallowed.
create or replace function public.ri_room_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare why text; r record;
begin
  begin
    if new.status is distinct from old.status and new.status <> 'waiting' then
      why := case when new.status = 'lobby' then 'full' when new.status = 'playing' then 'started' else 'closed' end;
      for r in update public.room_invitations set status = 'expired', close_reason = why, responded_at = clock_timestamp()
                where status = 'pending' and coalesce(bt_room_id, tz_room_id) = new.id
            returning sender_id, receiver_id
      loop
        perform public.fr_notify(r.receiver_id); perform public.fr_notify(r.sender_id);
      end loop;
    end if;
  exception when others then null;
  end;
  return new;
end $$;
create or replace function public.ri_team_filled() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap int; n int; r record;
begin
  begin
    select max_players into cap from public.tz_rooms where id = new.room_id;
    select count(*) into n from public.tz_players where room_id = new.room_id and not left_game;
    if cap is not null and n >= cap then
      for r in update public.room_invitations set status = 'expired', close_reason = 'full', responded_at = clock_timestamp()
                where status = 'pending' and tz_room_id = new.room_id
            returning sender_id, receiver_id
      loop
        perform public.fr_notify(r.receiver_id); perform public.fr_notify(r.sender_id);
      end loop;
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists ri_bt_status on public.battle_rooms;
create trigger ri_bt_status after update of status on public.battle_rooms for each row execute function public.ri_room_changed();
drop trigger if exists ri_tz_status on public.tz_rooms;
create trigger ri_tz_status after update of status on public.tz_rooms for each row execute function public.ri_room_changed();
drop trigger if exists ri_tz_filled on public.tz_players;
create trigger ri_tz_filled after insert on public.tz_players for each row execute function public.ri_team_filled();

revoke all on function public.ri_busy_fast(uuid) from public, anon, authenticated;
revoke all on function public.ri_busy(uuid) from public, anon, authenticated;
revoke all on function public.ri_room(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ri_expire(uuid) from public, anon, authenticated;
revoke all on function public.ri_room_changed() from public, anon, authenticated;
revoke all on function public.ri_team_filled() from public, anon, authenticated;

-- ================================================================ public doors (these are what the app calls)

-- The host's "Invite Friends" list for ONE room: every friend with their live status and what they can be offered.
-- state: none (can be invited) | invited (waiting for their answer) | declined | in_room | busy (in another battle)
create or replace function public.ri_friends(p_mode text, p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; rs record; fl json;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  if p_mode is null or p_mode not in ('friend', 'team') then return json_build_object('ok', false, 'reason', 'bad_mode'); end if;
  select * into rs from public.ri_room(p_mode, p_room, me);
  if not rs.o_found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if not rs.o_host then return json_build_object('ok', false, 'reason', 'forbidden'); end if;      -- only the host sees the list
  perform public.ri_expire(me);

  select coalesce(json_agg(t order by t.online desc, lower(t.name)), '[]'::json) into fl from (
    select f.id as fid, c.uname as name, c.av as avatar, c.lv as level, public.fr_online(o.pid) as online,
           case
             when (p_mode = 'friend' and exists (select 1 from public.battle_players p where p.room_id = p_room and (p.user_id = o.pid or p.guest_pid = o.pid)))
               or (p_mode = 'team' and exists (select 1 from public.tz_players p where p.room_id = p_room and not p.left_game and (p.user_id = o.pid or p.guest_pid = o.pid)))
               then 'in_room'
             when iv.status = 'pending' then 'invited'
             when iv.status = 'declined' then 'declined'
             when public.ri_busy_fast(o.pid) then 'busy'
             else 'none' end as state,
           iv.id as iid
      from public.friendships f
      cross join lateral (select case when f.player_one_id = me then f.player_two_id else f.player_one_id end as pid) o
      cross join lateral public.fr_card(o.pid) c
      left join lateral (select i.id, i.status from public.room_invitations i
                          where i.receiver_id = o.pid and coalesce(i.bt_room_id, i.tz_room_id) = p_room and i.status in ('pending', 'declined')
                          order by i.created_at desc limit 1) iv on true
     where f.player_one_id = me or f.player_two_id = me
     limit 200) t;

  return json_build_object('ok', true, 'open', rs.o_open, 'count', rs.o_count, 'cap', rs.o_cap, 'friends', fl);
end $$;

-- Invite one friend (by friendship id) to my open room. The invitation arrives as a notification, live.
create or replace function public.ri_send(p_mode text, p_room uuid, p_friendship uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; rs record; fs public.friendships%rowtype; other uuid; iid uuid; prev record; expiry timestamptz;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  if p_mode is null or p_mode not in ('friend', 'team') then return json_build_object('ok', false, 'reason', 'bad_mode'); end if;
  select * into rs from public.ri_room(p_mode, p_room, me);
  if not rs.o_found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if not rs.o_host then return json_build_object('ok', false, 'reason', 'forbidden'); end if;      -- only the host may invite
  if not rs.o_open then
    return json_build_object('ok', false, 'reason', case when rs.o_count >= rs.o_cap then 'full' when rs.o_status = 'playing' then 'started' else 'closed' end);
  end if;

  select * into fs from public.friendships where id = p_friendship and (player_one_id = me or player_two_id = me);
  if not found then return json_build_object('ok', false, 'reason', 'not_friends'); end if;
  other := case when fs.player_one_id = me then fs.player_two_id else fs.player_one_id end;
  perform public.ri_expire(me);

  if (p_mode = 'friend' and exists (select 1 from public.battle_players p where p.room_id = p_room and (p.user_id = other or p.guest_pid = other)))
  or (p_mode = 'team' and exists (select 1 from public.tz_players p where p.room_id = p_room and not p.left_game and (p.user_id = other or p.guest_pid = other))) then
    return json_build_object('ok', false, 'reason', 'in_room');
  end if;
  select i.status into prev from public.room_invitations i
   where i.receiver_id = other and coalesce(i.bt_room_id, i.tz_room_id) = p_room and i.status in ('pending', 'declined') order by i.created_at desc limit 1;
  if found then return json_build_object('ok', false, 'reason', case when prev.status = 'pending' then 'already_invited' else 'declined' end); end if;
  if (select count(*) from public.room_invitations where sender_id = me and created_at > now() - interval '1 minute') >= 10 then
    return json_build_object('ok', false, 'reason', 'throttled');
  end if;
  if public.ri_busy(other) is not null then return json_build_object('ok', false, 'reason', 'friend_busy'); end if;

  expiry := case when p_mode = 'friend' then (select expires_at from public.battle_rooms where id = p_room)
              else (select expires_at from public.tz_rooms where id = p_room) end;
  expiry := least(coalesce(expiry, now()), now() + interval '10 minutes');
  if expiry <= now() then return json_build_object('ok', false, 'reason', 'closed'); end if;

  begin
    insert into public.room_invitations (sender_id, receiver_id, mode, bt_room_id, tz_room_id, expires_at)
    values (me, other, p_mode, case when p_mode = 'friend' then p_room end, case when p_mode = 'team' then p_room end, expiry) returning id into iid;
  exception when unique_violation then
    return json_build_object('ok', false, 'reason', 'already_invited');
  end;
  insert into public.notifications (receiver_id, type, related_id) values (other, 'room_invite', iid) on conflict do nothing;
  perform public.fr_notify(other);
  perform public.fr_notify(me);
  return json_build_object('ok', true, 'invite_id', iid);
end $$;

-- Withdraw an invitation I sent.
create or replace function public.ri_cancel(p_invite uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; iv public.room_invitations%rowtype;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  select * into iv from public.room_invitations where id = p_invite and sender_id = me for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if iv.status <> 'pending' then return json_build_object('ok', false, 'reason', 'not_pending', 'status', iv.status); end if;
  update public.room_invitations set status = 'cancelled', responded_at = clock_timestamp() where id = iv.id;
  delete from public.notifications where receiver_id = iv.receiver_id and type = 'room_invite' and related_id = iv.id;
  perform public.fr_notify(iv.receiver_id);
  perform public.fr_notify(me);
  return json_build_object('ok', true, 'status', 'cancelled');
end $$;

-- Accept or decline a room invitation. Accepting seats me in THAT room (no code) and returns the room's state.
create or replace function public.ri_respond(p_invite uuid, p_accept boolean, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; iv public.room_invitations%rowtype; rs record; rid uuid; busy uuid; why text; st json;
        r public.battle_rooms%rowtype; pl public.battle_players%rowtype; z public.tz_rooms%rowtype; tp public.tz_players%rowtype;
        c record; acct boolean; h text; uname text; host_name text; seat_no int; i int; already boolean;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  select * into iv from public.room_invitations where id = p_invite and receiver_id = me for update;     -- only the receiver can answer
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if iv.status <> 'pending' then
    return json_build_object('ok', false, 'status', iv.status,
      'reason', case when iv.status = 'expired' then coalesce(case when iv.close_reason = 'timeout' then 'expired' else iv.close_reason end, 'expired')
                     when iv.status = 'cancelled' then 'cancelled' else 'not_pending' end);
  end if;
  if iv.expires_at < clock_timestamp() then
    update public.room_invitations set status = 'expired', close_reason = 'timeout', responded_at = clock_timestamp() where id = iv.id;
    perform public.fr_notify(me);
    return json_build_object('ok', false, 'reason', 'expired');
  end if;
  rid := coalesce(iv.bt_room_id, iv.tz_room_id);

  if not coalesce(p_accept, false) then
    update public.room_invitations set status = 'declined', responded_at = clock_timestamp() where id = iv.id;
    update public.notifications set is_read = true where receiver_id = me and type = 'room_invite' and related_id = iv.id;
    insert into public.notifications (receiver_id, type, related_id) values (iv.sender_id, 'room_invite_declined', iv.id) on conflict do nothing;
    perform public.fr_notify(iv.sender_id);
    perform public.fr_notify(me);
    return json_build_object('ok', true, 'status', 'declined');
  end if;

  -- accepting: is the room still open, am I still allowed in, and is there still a seat?
  select * into rs from public.ri_room(iv.mode, rid, iv.sender_id);
  if not rs.o_found or not rs.o_host then
    update public.room_invitations set status = 'expired', close_reason = 'closed', responded_at = clock_timestamp() where id = iv.id;
    perform public.fr_notify(me);
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  already := (iv.mode = 'friend' and exists (select 1 from public.battle_players where room_id = rid and (user_id = me or guest_pid = me)))
          or (iv.mode = 'team' and exists (select 1 from public.tz_players where room_id = rid and not left_game and (user_id = me or guest_pid = me)));
  if not already then
    if not rs.o_open then
      why := case when rs.o_count >= rs.o_cap then 'full' when rs.o_status = 'playing' then 'started' else 'closed' end;
      update public.room_invitations set status = 'expired', close_reason = why, responded_at = clock_timestamp() where id = iv.id;
      perform public.fr_notify(me); perform public.fr_notify(iv.sender_id);
      return json_build_object('ok', false, 'reason', why);
    end if;
    if not public.fr_are_friends(me, iv.sender_id) then
      update public.room_invitations set status = 'cancelled', responded_at = clock_timestamp() where id = iv.id;
      perform public.fr_notify(me);
      return json_build_object('ok', false, 'reason', 'not_friends');
    end if;
    busy := public.ri_busy(me);
    if busy is not null then return json_build_object('ok', false, 'reason', 'busy', 'room_id', busy); end if;

    if iv.mode = 'friend' then
      select username into host_name from public.battle_players where room_id = rid and seat = 1;
      perform public.fr_seat(rid, 2, me, host_name);
      update public.battle_rooms set status = 'lobby', expires_at = now() + interval '10 minutes', version = version + 1 where id = rid;
      update public.battle_players set is_ready = false where room_id = rid;
      perform public.bt_bump(rid);
    else
      select * into c from public.fr_card(me);
      acct := exists (select 1 from public.profiles where id = me);
      if not acct then select guest_key_hash into h from public.friend_presence where player_id = me and user_id is null; end if;
      uname := c.uname;
      for i in 2..9 loop                                                      -- two players never share a name in one room
        exit when not exists (select 1 from public.tz_players where room_id = rid and lower(username) = lower(uname));
        uname := left(c.uname, 12) || '_' || i;
      end loop;
      select g into seat_no from generate_series(1, rs.o_cap) g
       where not exists (select 1 from public.tz_players p where p.room_id = rid and p.seat = g) order by g limit 1;
      insert into public.tz_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar)
      values (rid, seat_no, case when acct then me end, case when not acct then me end, case when not acct then h end, uname, c.av);
      update public.tz_players set is_ready = false where room_id = rid;      -- the roster changed: everyone readies again
      perform public.tz_bump(rid);
    end if;
  end if;

  if iv.mode = 'friend' then
    select * into r from public.battle_rooms where id = rid;
    select * into pl from public.battle_players where room_id = rid and (user_id = me or guest_pid = me);
    st := public.bt_view(r, pl);
  else
    select * into z from public.tz_rooms where id = rid;
    select * into tp from public.tz_players where room_id = rid and (user_id = me or guest_pid = me) and not left_game;
    st := public.tz_view(z, tp);
  end if;

  update public.room_invitations set status = 'accepted', responded_at = clock_timestamp() where id = iv.id;
  update public.notifications set is_read = true where receiver_id = me and type = 'room_invite' and related_id = iv.id;
  insert into public.notifications (receiver_id, type, related_id) values (iv.sender_id, 'room_invite_accepted', iv.id) on conflict do nothing;
  perform public.fr_notify(iv.sender_id);
  perform public.fr_notify(me);
  return json_build_object('ok', true, 'status', 'accepted', 'mode', iv.mode, 'room_id', rid, 'state', st);
end $$;

revoke all on function public.ri_friends(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ri_send(text, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ri_cancel(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ri_respond(uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.ri_friends(text, uuid, uuid, text) to anon, authenticated;
grant execute on function public.ri_send(text, uuid, uuid, uuid, text) to anon, authenticated;
grant execute on function public.ri_cancel(uuid, uuid, text) to anon, authenticated;
grant execute on function public.ri_respond(uuid, boolean, uuid, text) to anon, authenticated;

-- ================================================================ the notification overview, now including room invitations
-- (007's fr_overview with three additions: it closes stale room invitations, returns "room_inv_in", and understands the
--  three new notification types. Everything else in it is unchanged.)
create or replace function public.fr_overview(p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; me uuid; fl json; inc json; outg json; iin json; iout json; rin json; nt json; unread int;
begin
  select * into a from public.fr_actor(p_pid, p_secret);
  if not a.o_ok then return json_build_object('ok', false, 'reason', a.o_reason); end if;
  me := a.o_pid;
  perform public.fr_expire(me);
  perform public.ri_expire(me);

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

  -- NEW (012): invitations to join a room that is already open (Friend Zone / Team Zone waiting lobby)
  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into rin from (
    select i.id as iid, i.mode, c.uname as name, c.av as avatar, c.lv as level,
           coalesce(b.difficulty, z.difficulty) as difficulty,
           case i.mode when 'team' then (select count(*) from public.tz_players p where p.room_id = i.tz_room_id and not p.left_game)
                       else (select count(*) from public.battle_players p where p.room_id = i.bt_room_id) end as players,
           case i.mode when 'team' then z.max_players else 2 end as cap,
           i.created_at, (extract(epoch from (i.expires_at - clock_timestamp())) * 1000)::bigint as expires_in_ms
      from public.room_invitations i cross join lateral public.fr_card(i.sender_id) c
      left join public.battle_rooms b on b.id = i.bt_room_id
      left join public.tz_rooms z on z.id = i.tz_room_id
     where i.receiver_id = me and i.status = 'pending' and i.expires_at > clock_timestamp()) t;

  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into nt from (
    select n.id as nid, n.type, n.related_id, n.is_read, n.created_at, c.uname as name, c.av as avatar,
           coalesce(i.status, ri.status) as inv_status, coalesce(i.difficulty, rb.difficulty, rz.difficulty) as difficulty, i.room_id, r.status as req_status,
           ri.mode as room_mode
      from public.notifications n
      left join public.friend_requests r on r.id = n.related_id and n.type in ('friend_request', 'friend_accepted')
      left join public.battle_invitations i on i.id = n.related_id and n.type in ('battle_invite', 'invite_accepted', 'invite_declined')
      left join public.room_invitations ri on ri.id = n.related_id and n.type in ('room_invite', 'room_invite_accepted', 'room_invite_declined')
      left join public.battle_rooms rb on rb.id = ri.bt_room_id
      left join public.tz_rooms rz on rz.id = ri.tz_room_id
      cross join lateral (select case n.type when 'friend_request' then r.sender_id when 'friend_accepted' then r.receiver_id
                                             when 'battle_invite' then i.sender_id when 'room_invite' then ri.sender_id
                                             when 'room_invite_accepted' then ri.receiver_id when 'room_invite_declined' then ri.receiver_id else i.receiver_id end as pid) o
      cross join lateral public.fr_card(o.pid) c
     where n.receiver_id = me and o.pid is not null
     order by n.created_at desc limit 40) t;

  select count(*) into unread from public.notifications where receiver_id = me and not is_read;

  return json_build_object('ok', true, 'me', me, 'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'friends', fl, 'incoming', inc, 'outgoing', outg, 'inv_in', iin, 'inv_out', iout, 'room_inv_in', rin, 'notifs', nt, 'unread', unread);
end $$;

grant execute on function public.fr_overview(uuid, text) to anon, authenticated;