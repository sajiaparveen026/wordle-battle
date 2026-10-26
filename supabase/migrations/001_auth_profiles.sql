-- Wordle Battle: profiles + solo save + security (run once in Supabase > SQL Editor).
-- Passwords are NEVER stored here; Supabase Auth owns credentials (auth.users).

-- ===== profiles: one row per user, created by a trigger when an account is created =====
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  avatar      text not null default '🦊',
  created_at  timestamptz not null default now(),
  -- Trusted competitive values. Clients can NOT write these (see column grants below);
  -- only server-side functions (added in the online-battle stage) may change them.
  level       int  not null default 1,
  xp          int  not null default 0,
  coins       int  not null default 100,
  wins        int  not null default 0,
  losses      int  not null default 0,
  streak      int  not null default 0,
  best_streak int  not null default 0,
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  constraint avatar_len check (char_length(avatar) between 1 and 8),
  constraint nonneg check (level >= 1 and xp >= 0 and coins >= 0 and wins >= 0 and losses >= 0 and streak >= 0 and best_streak >= 0)
);
-- Case-insensitive uniqueness: "Sam" and "sam" cannot both exist.
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- No insert/delete policies: rows are created by the trigger and removed with the auth user.

-- Column-level security: a signed-in user may change ONLY username and avatar.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, avatar) on public.profiles to authenticated;

-- ===== create the profile automatically at signup (email or Google) =====
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare base text; candidate text; tries int := 0;
begin
  base := coalesce(new.raw_user_meta_data->>'username', '');
  if base !~ '^[A-Za-z0-9_]{3,16}$' then          -- missing/invalid (e.g. Google signup): derive one
    base := left(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^A-Za-z0-9_]', '', 'g'), 11);
    if char_length(base) < 3 then base := 'player'; end if;
  end if;
  candidate := base;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    tries := tries + 1;
    candidate := left(base, 11) || '_' || (1000 + floor(random() * 9000))::int;
    if tries > 20 then candidate := 'player_' || substr(replace(new.id::text, '-', ''), 1, 8); exit; end if;
  end loop;
  begin
    insert into public.profiles (id, username) values (new.id, candidate);
  exception when unique_violation then          -- extremely rare race: fall back to an id-based name
    insert into public.profiles (id, username) values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 8));
  end;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Safety net: lets the app create a missing profile for the signed-in user.
create or replace function public.ensure_profile() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, username) values (auth.uid(), 'player_' || substr(replace(auth.uid()::text, '-', ''), 1, 8));
  end if;
end $$;
revoke all on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;

-- Used by the signup form to say "username taken" before creating the account.
create or replace function public.username_available(p_username text) returns boolean
language sql security definer stable set search_path = '' as $$
  select p_username ~ '^[A-Za-z0-9_]{3,16}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(p_username));
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ===== solo_saves: a player's PRIVATE solo-mode save (coins/hints/stats), synced across devices =====
-- This is a personal save, NOT a trusted score: it must never feed rankings or competitive rewards.
create table if not exists public.solo_saves (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null,
  rev        int not null default 1,
  updated_at timestamptz not null default now(),
  constraint data_is_object check (jsonb_typeof(data) = 'object'),
  constraint data_size check (octet_length(data::text) <= 50000)
);
alter table public.solo_saves enable row level security;
drop policy if exists "solo_select_own" on public.solo_saves;
drop policy if exists "solo_insert_own" on public.solo_saves;
drop policy if exists "solo_update_own" on public.solo_saves;
create policy "solo_select_own" on public.solo_saves for select to authenticated using (auth.uid() = user_id);
create policy "solo_insert_own" on public.solo_saves for insert to authenticated with check (auth.uid() = user_id);
create policy "solo_update_own" on public.solo_saves for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.solo_saves from anon, authenticated;
grant select, insert on public.solo_saves to authenticated;
grant update (data) on public.solo_saves to authenticated;

-- Server controls rev/updated_at and throttles writes (max one per second per player).
create or replace function public.solo_saves_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.rev := 1; new.updated_at := now(); return new; end if;
  if clock_timestamp() - old.updated_at < interval '1 second' then raise exception 'rate_limited'; end if;
  new.user_id := old.user_id; new.rev := old.rev + 1; new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists solo_saves_guard_trg on public.solo_saves;
create trigger solo_saves_guard_trg before insert or update on public.solo_saves for each row execute function public.solo_saves_guard();
