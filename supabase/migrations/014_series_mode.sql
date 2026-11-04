-- Wordle Battle: Series Mode, STAGE 1 (create / join / lobby). Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Needs 006-013 already run.
--
-- HOW IT FITS
--  * A series lobby IS a normal waiting room (battle_rooms for Friend Zone, tz_rooms for Team Zone) with a series_id on it.
--    So room codes, invites, ready, leave, expiry, capacity and "one battle at a time" checks are the existing ones.
--  * The series row keeps the settings (difficulty, timer, rounds) chosen by the host. Players cannot change them.
--  * Normal rooms have series_id NULL and behave exactly as before. Nothing existing is edited by this script.
--  * Same protection as the other tables: RLS on, no policies, no grants. The app only calls the series_* functions below.

create table if not exists public.series (
  id               uuid primary key default gen_random_uuid(),
  mode             text not null check (mode in ('friend', 'team')),
  difficulty       text not null check (difficulty in ('easy', 'medium', 'hard')),
  duration_seconds int  not null check (duration_seconds in (720, 480, 300)),
  total_rounds     int  not null check (total_rounds in (3, 5, 10)),
  max_players      int  not null check (max_players between 2 and 5),
  current_round    int  not null default 0,                       -- 0 = still in the lobby
  status           text not null default 'lobby' check (status in ('lobby', 'playing', 'finished', 'cancelled')),
  host_user_id     uuid references auth.users(id) on delete set null,
  host_guest_pid   uuid,
  created_at       timestamptz not null default now()
);
alter table public.series enable row level security;
revoke all on public.series from public, anon, authenticated;

alter table public.battle_rooms add column if not exists series_id    uuid references public.series(id) on delete set null;
alter table public.battle_rooms add column if not exists series_round int;
alter table public.tz_rooms     add column if not exists series_id    uuid references public.series(id) on delete set null;
alter table public.tz_rooms     add column if not exists series_round int;
create index if not exists battle_rooms_series_idx on public.battle_rooms (series_id) where series_id is not null;
create index if not exists tz_rooms_series_idx     on public.tz_rooms (series_id) where series_id is not null;

-- ---------------------------------------------------------------- helper: the settings the lobby shows
create or replace function public.series_json(p_series uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('id', s.id, 'mode', s.mode, 'difficulty', s.difficulty, 'duration_seconds', s.duration_seconds,
                           'total_rounds', s.total_rounds, 'max_players', s.max_players, 'current_round', s.current_round, 'status', s.status)
    from public.series s where s.id = p_series;
$$;
revoke all on function public.series_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- create a series (host)
-- Friend Zone: p_mode 'friend' (2 players). Team Zone: p_mode 'team' with p_max 3..5.
create or replace function public.series_create(p_mode text, p_difficulty text, p_rounds int, p_max int default null,
                                                p_pid uuid default null, p_secret text default null,
                                                p_username text default null, p_avatar text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare res json; rid uuid; sid uuid; a record; secs int;
begin
  if p_mode not in ('friend', 'team') then return json_build_object('ok', false, 'reason', 'bad_mode'); end if;
  if p_rounds is null or p_rounds not in (3, 5, 10) then return json_build_object('ok', false, 'reason', 'bad_rounds'); end if;
  secs := case p_difficulty when 'easy' then 720 when 'medium' then 480 when 'hard' then 300 end;
  if secs is null then return json_build_object('ok', false, 'reason', 'bad_difficulty'); end if;
  if p_mode = 'team' and (p_max is null or p_max not between 3 and 5) then return json_build_object('ok', false, 'reason', 'bad_size'); end if;

  -- the existing door makes the room, the host seat, the code and all the existing checks (already in a room, throttle, ...)
  if p_mode = 'friend' then res := public.bt_create_room(p_difficulty, p_pid, p_secret, p_username, p_avatar);
  else res := public.tz_create(p_difficulty, p_max, p_pid, p_secret, p_username, p_avatar); end if;
  if not coalesce((res->>'ok')::boolean, false) then return res; end if;

  rid := (res->'state'->'room'->>'id')::uuid;
  select * into a from public.bt_actor(p_pid, p_secret);
  insert into public.series (mode, difficulty, duration_seconds, total_rounds, max_players, host_user_id, host_guest_pid)
  values (p_mode, p_difficulty, secs, p_rounds, case when p_mode = 'friend' then 2 else p_max end, a.uid, case when a.uid is null then p_pid end)
  returning id into sid;
  if p_mode = 'friend' then update public.battle_rooms set series_id = sid, series_round = 1 where id = rid;
  else update public.tz_rooms set series_id = sid, series_round = 1 where id = rid; end if;

  return json_build_object('ok', true, 'state', res->'state', 'series', public.series_json(sid));
end $$;

-- ---------------------------------------------------------------- join a series by code
create or replace function public.series_join(p_mode text, p_code text, p_pid uuid default null, p_secret text default null,
                                              p_username text default null, p_avatar text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare res json; code text; sid uuid; found_room boolean := false;
begin
  if p_mode not in ('friend', 'team') then return json_build_object('ok', false, 'reason', 'bad_mode'); end if;
  code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(code) <> 6 then return json_build_object('ok', false, 'reason', 'invalid_code'); end if;

  if p_mode = 'friend' then select series_id, true into sid, found_room from public.battle_rooms where room_code = code;
  else select series_id, true into sid, found_room from public.tz_rooms where room_code = code; end if;
  if not coalesce(found_room, false) then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if sid is null then return json_build_object('ok', false, 'reason', 'not_series'); end if;   -- a normal room: use Enter a Room instead

  if p_mode = 'friend' then res := public.bt_join_room(code, p_pid, p_secret, p_username, p_avatar);
  else res := public.tz_join(code, p_pid, p_secret, p_username, p_avatar); end if;
  if not coalesce((res->>'ok')::boolean, false) then return res; end if;
  return json_build_object('ok', true, 'state', res->'state', 'series', public.series_json(sid));
end $$;

-- ---------------------------------------------------------------- the settings of the series my room belongs to (after a refresh, or an invitation)
create or replace function public.series_info(p_mode text, p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer stable set search_path = '' as $$
declare sid uuid; ok boolean := false;
begin
  if p_mode = 'friend' then
    ok := (public.bt_mine(p_room, p_pid, p_secret)).id is not null;
    if ok then select series_id into sid from public.battle_rooms where id = p_room; end if;
  elsif p_mode = 'team' then
    ok := (public.tz_mine(p_room, p_pid, p_secret)).id is not null;
    if ok then select series_id into sid from public.tz_rooms where id = p_room; end if;
  end if;
  if not ok then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  return json_build_object('ok', true, 'series', case when sid is null then null else public.series_json(sid) end);
end $$;

revoke all on function public.series_create(text, text, int, int, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.series_join(text, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.series_info(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.series_create(text, text, int, int, uuid, text, text, text) to anon, authenticated;
grant execute on function public.series_join(text, text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.series_info(text, uuid, uuid, text) to anon, authenticated;