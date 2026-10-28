-- Wordle Battle: free daily coins (once per day per account), enforced by the server.
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- The app never writes this table directly: players have no insert/update rights.
-- The only way to claim is the function below, which compares the day sent by the app
-- with the last claimed day stored here, so refreshing, clearing the browser or using
-- another device cannot claim twice in the same day.

create table if not exists public.free_coin_claims (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  last_claim_day date        not null,
  total_claims   integer     not null default 1,
  updated_at     timestamptz not null default now()
);

alter table public.free_coin_claims enable row level security;

drop policy if exists "read own claim" on public.free_coin_claims;
create policy "read own claim" on public.free_coin_claims
  for select to authenticated using (user_id = auth.uid());
-- no insert / update / delete policies on purpose: only the functions below may change it

-- Claim 50 coins for the player's local day p_day (YYYY-MM-DD).
-- A day is accepted only if it is within one day of the server's UTC date (covers every time zone,
-- but stops a player from sending far-future days) and is later than the last claimed day.
create or replace function public.claim_free_coins(p_day date)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  n         integer;
  last_day  date;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_day is null or p_day < utc_today - 1 or p_day > utc_today + 1 then
    return json_build_object('ok', false, 'reason', 'bad_day');
  end if;

  insert into public.free_coin_claims as c (user_id, last_claim_day)
  values (uid, p_day)
  on conflict (user_id) do update
    set last_claim_day = excluded.last_claim_day,
        total_claims   = c.total_claims + 1,
        updated_at     = now()
    where c.last_claim_day < excluded.last_claim_day;   -- a second claim for the same day updates 0 rows
  get diagnostics n = row_count;

  if n = 0 then
    select last_claim_day into last_day from public.free_coin_claims where user_id = uid;
    return json_build_object('ok', false, 'reason', 'already', 'last_claim_day', last_day);
  end if;
  return json_build_object('ok', true, 'coins', 50, 'day', p_day);
end;
$$;

-- Last day this player claimed (null if never), so every device shows the same state.
create or replace function public.free_coins_status()
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  uid      uuid := auth.uid();
  last_day date;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select last_claim_day into last_day from public.free_coin_claims where user_id = uid;
  return json_build_object('last_claim_day', last_day);
end;
$$;

revoke all on function public.claim_free_coins(date) from public, anon;
revoke all on function public.free_coins_status() from public, anon;
grant execute on function public.claim_free_coins(date) to authenticated;
grant execute on function public.free_coins_status() to authenticated;