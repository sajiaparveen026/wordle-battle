-- Wordle Battle: public leaderboard for registered players AND guests.
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- HOW IT IS PROTECTED
--  * The table has Row Level Security ON and NO policies and NO table grants: the app can never read or write it directly.
--  * The only doors are the functions below. They return/accept ONLY public data: username, avatar, level, XP, wins.
--    Emails, passwords, user ids and guest secrets never leave the database.
--  * Registered players: username + avatar are copied from `profiles` on the server (the app cannot choose them),
--    and the level is calculated on the server from the XP.
--  * Guests: the app makes a random id + a secret on the device. Only a hash of the secret is stored, so nobody else
--    can overwrite or delete that guest's entry.
--
-- HONEST LIMIT: solo games are played on the player's own device, so XP and wins are reported by the app.
-- The functions reject impossible numbers and throttle updates, but a determined person calling the API by hand
-- could still post made-up scores. True cheat-proof rankings need games to be played and verified on the server
-- (the online-battle stage). Until then, treat this board as friendly, not competitive-for-prizes.

create table if not exists public.leaderboard (
  pid            uuid primary key default gen_random_uuid(),       -- public id of the entry (a guest's id is chosen by the guest's device)
  user_id        uuid unique references auth.users(id) on delete cascade,   -- set for registered players, never shown
  guest_key_hash text,                                             -- sha256 of the guest's secret, never shown
  username       text not null,
  avatar         text not null default '🦊',
  level          int  not null default 1,
  xp             int  not null default 0,
  wins           int  not null default 0,
  games          int  not null default 1,                          -- wins + losses, used for validation only
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint lb_username_format check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  constraint lb_avatar_len      check (char_length(avatar) between 1 and 8),
  constraint lb_numbers         check (level >= 1 and xp >= 0 and wins >= 0 and games >= 1 and wins <= games),
  constraint lb_owner           check ((user_id is not null and guest_key_hash is null) or (user_id is null and guest_key_hash is not null))
);
-- No two players share a name (any capitalisation).
create unique index if not exists lb_username_lower_key on public.leaderboard (lower(username));
create index if not exists lb_rank_idx on public.leaderboard (xp desc, wins desc, created_at asc);

alter table public.leaderboard enable row level security;
-- (deliberately no policies: with RLS on, no policy means no direct access for anon / authenticated)
revoke all on public.leaderboard from public, anon, authenticated;

-- ---------- internal helpers (not callable from the app) ----------
-- Level from total XP: level n needs 100 + (n-1)*50 XP, exactly like the app.
create or replace function public.lb_level(p_xp int) returns int
language plpgsql immutable set search_path = '' as $$
declare lv int := 1; x int := greatest(coalesce(p_xp, 0), 0);
begin
  while x >= 100 + (lv - 1) * 50 loop x := x - (100 + (lv - 1) * 50); lv := lv + 1; end loop;
  return lv;
end $$;

-- Returns NULL when the numbers are believable, otherwise a short reason.
create or replace function public.lb_check(p_xp int, p_wins int, p_games int) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_xp is null or p_wins is null or p_games is null then return 'bad_values'; end if;
  if p_games < 1 or p_wins < 0 or p_xp < 0 or p_wins > p_games then return 'bad_values'; end if;
  if p_xp > 5000000 or p_wins > 100000 or p_games > 200000 then return 'bad_values'; end if;
  if p_xp > p_wins * 100 + 200 then return 'bad_values'; end if;      -- a win is worth at most 60 XP
  return null;
end $$;

-- A name nobody else (on the board or among registered players) is using.
create or replace function public.lb_free_name(p_base text, p_pid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare cand text := p_base; tries int := 0;
begin
  while exists (select 1 from public.leaderboard where lower(username) = lower(cand) and pid <> p_pid)
     or exists (select 1 from public.profiles where lower(username) = lower(cand)) loop
    tries := tries + 1;
    cand := left(p_base, 11) || '_' || (1000 + floor(random() * 9000))::int;
    if tries > 20 then cand := 'guest_' || substr(replace(p_pid::text, '-', ''), 1, 8); exit; end if;
  end loop;
  return cand;
end $$;
revoke all on function public.lb_level(int) from public, anon, authenticated;
revoke all on function public.lb_check(int, int, int) from public, anon, authenticated;
revoke all on function public.lb_free_name(text, uuid) from public, anon, authenticated;

-- ---------- registered players: save my numbers ----------
create or replace function public.lb_submit_account(p_xp int, p_wins int, p_games int) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); prof record; mine public.leaderboard%rowtype; why text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  why := public.lb_check(p_xp, p_wins, p_games);
  if why is not null then return json_build_object('ok', false, 'reason', why); end if;
  select username, avatar into prof from public.profiles where id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'no_profile'); end if;

  select * into mine from public.leaderboard where user_id = uid;
  if found and clock_timestamp() - mine.updated_at < interval '2 seconds' then
    return json_build_object('ok', false, 'reason', 'throttled');
  end if;

  -- a guest (or an old entry) that happens to use my registered name gets a new one: registered names win
  update public.leaderboard set username = public.lb_free_name(username, pid)
   where lower(username) = lower(prof.username) and user_id is distinct from uid;

  insert into public.leaderboard (user_id, username, avatar, level, xp, wins, games)
  values (uid, prof.username, prof.avatar, public.lb_level(p_xp), p_xp, p_wins, p_games)
  on conflict (user_id) do update
    set username = excluded.username, avatar = excluded.avatar, level = excluded.level,
        xp = excluded.xp, wins = excluded.wins, games = excluded.games, updated_at = clock_timestamp();
  return json_build_object('ok', true);
end $$;

-- ---------- guests: save my numbers (no account needed) ----------
create or replace function public.lb_submit_guest(p_pid uuid, p_secret text, p_username text, p_avatar text, p_xp int, p_wins int, p_games int) returns json
language plpgsql security definer set search_path = '' as $$
declare h text; r public.leaderboard%rowtype; nm text; av text; why text;
begin
  if p_pid is null or p_secret is null or char_length(p_secret) < 24 or char_length(p_secret) > 100 then
    return json_build_object('ok', false, 'reason', 'bad_id');
  end if;
  why := public.lb_check(p_xp, p_wins, p_games);
  if why is not null then return json_build_object('ok', false, 'reason', why); end if;
  h  := encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
  av := case when p_avatar is not null and char_length(p_avatar) between 1 and 8 then p_avatar else '🦊' end;
  nm := case when p_username is not null and p_username ~ '^[A-Za-z0-9_]{3,16}$' then p_username else 'Player' || (1000 + floor(random() * 9000))::int end;

  select * into r from public.leaderboard where pid = p_pid;
  if found then
    if r.user_id is not null or r.guest_key_hash is distinct from h then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
    if clock_timestamp() - r.updated_at < interval '2 seconds' then return json_build_object('ok', false, 'reason', 'throttled'); end if;
    nm := public.lb_free_name(nm, p_pid);
    update public.leaderboard
       set username = nm, avatar = av, level = public.lb_level(p_xp), xp = p_xp, wins = p_wins, games = p_games, updated_at = clock_timestamp()
     where pid = p_pid;
  else
    nm := public.lb_free_name(nm, p_pid);
    begin
      insert into public.leaderboard (pid, guest_key_hash, username, avatar, level, xp, wins, games)
      values (p_pid, h, nm, av, public.lb_level(p_xp), p_xp, p_wins, p_games);
    exception when unique_violation then          -- a name race: fall back to an id-based name
      nm := 'guest_' || substr(replace(p_pid::text, '-', ''), 1, 8);
      insert into public.leaderboard (pid, guest_key_hash, username, avatar, level, xp, wins, games)
      values (p_pid, h, nm, av, public.lb_level(p_xp), p_xp, p_wins, p_games);
    end;
  end if;
  return json_build_object('ok', true, 'username', nm);
end $$;

-- ---------- guests: remove my entry (used when a guest creates an account, or resets their progress) ----------
create or replace function public.lb_remove_guest(p_pid uuid, p_secret text) returns json
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  if p_pid is null or p_secret is null or char_length(p_secret) < 24 or char_length(p_secret) > 100 then return json_build_object('ok', false); end if;
  h := encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
  delete from public.leaderboard where pid = p_pid and user_id is null and guest_key_hash = h;
  return json_build_object('ok', true);
end $$;

-- ---------- everyone: read the rankings ----------
-- Sorted by XP, then wins, then who got there first. p_pid is a guest's own id (so the guest can see their rank);
-- a signed-in player is recognised automatically. Returns only public fields.
create or replace function public.lb_get(p_limit int default 50, p_pid uuid default null) returns json
language plpgsql security definer stable set search_path = '' as $$
declare lim int := least(greatest(coalesce(p_limit, 50), 1), 100); me_pid uuid; result json;
begin
  if p_pid is not null then
    select pid into me_pid from public.leaderboard where pid = p_pid and user_id is null;
  elsif auth.uid() is not null then
    select pid into me_pid from public.leaderboard where user_id = auth.uid();
  end if;
  with ranked as (
    select l.pid, l.username, l.avatar, l.level, l.xp, l.wins, (l.user_id is null) as is_guest,
           row_number() over (order by l.xp desc, l.wins desc, l.created_at asc, l.pid asc) as place
      from public.leaderboard l
  )
  select json_build_object(
    'total', (select count(*) from ranked),
    'top',   coalesce((select json_agg(row_to_json(t) order by t.place) from (select * from ranked where place <= lim) t), '[]'::json),
    'me',    (select row_to_json(m) from ranked m where m.pid = me_pid)
  ) into result;
  return result;
end $$;

revoke all on function public.lb_submit_account(int, int, int) from public, anon, authenticated;
revoke all on function public.lb_submit_guest(uuid, text, text, text, int, int, int) from public, anon, authenticated;
revoke all on function public.lb_remove_guest(uuid, text) from public, anon, authenticated;
revoke all on function public.lb_get(int, uuid) from public, anon, authenticated;
grant execute on function public.lb_submit_account(int, int, int) to authenticated;
grant execute on function public.lb_submit_guest(uuid, text, text, text, int, int, int) to anon, authenticated;
grant execute on function public.lb_remove_guest(uuid, text) to anon, authenticated;
grant execute on function public.lb_get(int, uuid) to anon, authenticated;

-- Optional housekeeping (run by hand now and then): drop guests nobody has played as for 6 months.
--   delete from public.leaderboard where user_id is null and updated_at < now() - interval '180 days';