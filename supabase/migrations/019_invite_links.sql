-- Wordle Battle: shareable battle invitation links. Run once in the Supabase SQL Editor AFTER 014 (Series Mode lobby). Safe to run again.
--
-- THE LINK:  https://<your domain>/join-battle/<token>      (the app builds it from the address it is running on, so it is always your real domain)
--  * Every Friend Zone and Team Zone room gets its own invite token when the room is created (a column default: the existing create functions are NOT edited).
--    20 characters: a mode letter (f = Friend Zone, t = Team Zone) + 19 random hex characters (76 bits from gen_random_uuid(), i.e. not guessable).
--    The token is not the room code and holds no database id; the room code still works exactly as before as the backup way in.
--  * The token is never returned by the normal room views. Only a player who is IN the room can ask for it (inv_link), and only while the room is open.
--  * inv_preview: what the invitation screen shows (host name + avatar, mode, difficulty, slots) or why the invitation can't be used.
--    It never returns the room code, a room id or any player id.
--  * inv_join: joins through the EXISTING join functions (bt_join_room / tz_join), so capacity, "already in another battle", the "started" check, the
--    one-at-a-time lock that stops two people taking the last seat, duplicate joins, guests and accounts all behave exactly as they do with a code.
--  * Same protection as the other tables: RLS on, no policies, no grants. The app only calls the three inv_* functions below.

create or replace function public.gen_invite_token(p_prefix text) returns text
language sql volatile set search_path = '' as $$
  select p_prefix || substr(replace(gen_random_uuid()::text, '-', ''), 1, 19);
$$;
revoke all on function public.gen_invite_token(text) from public, anon, authenticated;

alter table public.battle_rooms add column if not exists invite_token text;
alter table public.tz_rooms     add column if not exists invite_token text;
alter table public.battle_rooms alter column invite_token set default public.gen_invite_token('f');
alter table public.tz_rooms     alter column invite_token set default public.gen_invite_token('t');
update public.battle_rooms set invite_token = public.gen_invite_token('f') where invite_token is null;   -- rooms that already exist get their own token too
update public.tz_rooms     set invite_token = public.gen_invite_token('t') where invite_token is null;
alter table public.battle_rooms alter column invite_token set not null;
alter table public.tz_rooms     alter column invite_token set not null;
create unique index if not exists battle_rooms_invite_token_key on public.battle_rooms (invite_token);
create unique index if not exists tz_rooms_invite_token_key     on public.tz_rooms (invite_token);

-- ---------------------------------------------------------------- the link for MY room (members only, while the room is open)
create or replace function public.inv_link(p_mode text, p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare tok text; code text; st text;
begin
  if p_mode = 'friend' then
    if (public.bt_mine(p_room, p_pid, p_secret)).id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
    select invite_token, room_code, status into tok, code, st from public.battle_rooms where id = p_room;
    if st not in ('waiting', 'lobby') then return json_build_object('ok', false, 'reason', 'closed'); end if;
  elsif p_mode = 'team' then
    if (public.tz_mine(p_room, p_pid, p_secret)).id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
    select invite_token, room_code, status into tok, code, st from public.tz_rooms where id = p_room;
    if st <> 'waiting' then return json_build_object('ok', false, 'reason', 'closed'); end if;
  else
    return json_build_object('ok', false, 'reason', 'bad_mode');
  end if;
  return json_build_object('ok', true, 'token', tok, 'code', code, 'mode', p_mode);
end $$;

-- ---------------------------------------------------------------- what the invitation screen shows
create or replace function public.inv_preview(p_token text, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer stable set search_path = '' as $$
declare tok text := lower(btrim(coalesce(p_token, ''))); md text; a record; r1 public.battle_rooms%rowtype; r2 public.tz_rooms%rowtype;
        rid uuid; st text; exp timestamptz; diff text; dur int; sid uuid; taken int; maxp int; hostn text; hosta text; mem boolean := false; why text;
begin
  if tok !~ '^[ft][0-9a-f]{19}$' then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  md := case left(tok, 1) when 'f' then 'friend' else 'team' end;
  select * into a from public.bt_actor(p_pid, p_secret);

  if md = 'friend' then
    select * into r1 from public.battle_rooms where invite_token = tok;
    if r1.id is null then return json_build_object('ok', false, 'reason', 'invalid'); end if;
    rid := r1.id; st := r1.status; exp := r1.expires_at; diff := r1.difficulty; dur := r1.duration_seconds; sid := r1.series_id; maxp := 2;
    select count(*) into taken from public.battle_players where room_id = rid and connection_status <> 'left';
    select username, avatar into hostn, hosta from public.battle_players where room_id = rid and seat = 1;
    if a.ok then mem := (public.bt_mine(rid, p_pid, p_secret)).id is not null; end if;
  else
    select * into r2 from public.tz_rooms where invite_token = tok;
    if r2.id is null then return json_build_object('ok', false, 'reason', 'invalid'); end if;
    rid := r2.id; st := r2.status; exp := r2.expires_at; diff := r2.difficulty; dur := r2.duration_seconds; sid := r2.series_id; maxp := r2.max_players;
    select count(*) into taken from public.tz_players where room_id = rid;
    select username, avatar into hostn, hosta from public.tz_players where room_id = rid and seat = 1;
    if a.ok then mem := (public.tz_mine(rid, p_pid, p_secret)).id is not null; end if;
  end if;

  why := case
    when mem and st in ('waiting', 'lobby', 'playing') then null                         -- already in this room: just take them back to it
    when st = 'cancelled' then 'cancelled'
    when st = 'expired' then 'expired'
    when st in ('waiting', 'lobby') and exp < now() then 'expired'
    when st = 'playing' then 'started'
    when st = 'finished' then 'finished'
    when md = 'friend' and st <> 'waiting' then 'full'
    when taken >= maxp then 'full'
    else null end;
  if why is not null then return json_build_object('ok', false, 'reason', why, 'mode', md); end if;

  return json_build_object('ok', true, 'mode', md, 'member', mem,
    'host', json_build_object('username', hostn, 'avatar', hosta),
    'difficulty', diff, 'duration_seconds', dur, 'players', taken, 'max_players', maxp, 'slots_left', greatest(maxp - taken, 0),
    'series', case when sid is null then null else public.series_json(sid) end);
end $$;

-- ---------------------------------------------------------------- join through the invitation
create or replace function public.inv_join(p_token text, p_pid uuid default null, p_secret text default null,
                                           p_username text default null, p_avatar text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare tok text := lower(btrim(coalesce(p_token, ''))); md text; code text; sid uuid; res json;
begin
  if tok !~ '^[ft][0-9a-f]{19}$' then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  md := case left(tok, 1) when 'f' then 'friend' else 'team' end;
  if md = 'friend' then select room_code, series_id into code, sid from public.battle_rooms where invite_token = tok;
  else select room_code, series_id into code, sid from public.tz_rooms where invite_token = tok; end if;
  if code is null then return json_build_object('ok', false, 'reason', 'invalid'); end if;

  if md = 'friend' then res := public.bt_join_room(code, p_pid, p_secret, p_username, p_avatar);
  else res := public.tz_join(code, p_pid, p_secret, p_username, p_avatar); end if;

  if not coalesce((res->>'ok')::boolean, false) then
    return json_build_object('ok', false, 'mode', md, 'reason', case when res->>'reason' = 'not_found' then 'invalid' else res->>'reason' end, 'room_id', res->>'room_id');
  end if;
  return json_build_object('ok', true, 'mode', md, 'state', res->'state', 'series', case when sid is null then null else public.series_json(sid) end);
end $$;

revoke all on function public.inv_link(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.inv_preview(text, uuid, text) from public, anon, authenticated;
revoke all on function public.inv_join(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.inv_link(text, uuid, uuid, text) to anon, authenticated;
grant execute on function public.inv_preview(text, uuid, text) to anon, authenticated;
grant execute on function public.inv_join(text, uuid, text, text, text) to anon, authenticated;