-- Wordle Battle: Spin Wheel (1 free spin per day, then 50 coins per spin). Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again. It does not depend on the other migrations.
--
-- WHAT THE SERVER DECIDES (signed-in players)
--   * which prize is won (a weighted random pick made inside the database, never by the app)
--   * whether a spin is the FREE one of the day (compared with the last free day stored here, so refreshing, logging out/in
--     or using another device can never give a second free spin the same day)
--   * each spin is stored once under the request id the app sends: repeating the same request returns the SAME result
--     and never a new prize (no duplicate rewards, no double spins)
--   The app then adds the prize to the coin/item balance and takes the 50 coins of a paid spin in ONE local step, once per request id.
--   (Coins are kept in each player's save, like free coins and game rewards, so the balance itself cannot be checked here.)
--
-- CONFIGURING THE PRIZES: edit the table wheel_prizes in Supabase (Table Editor), no code change needed.
--   weight = how likely (relative to the other rows), amount = coins or number of items, enabled = false hides a prize.
--   Keep 6 to 10 enabled rows. kind: 'coins' | 'hint' (hint_type 'reveal' | 'remove' | 'word') | 'skip'.
--   Guests (no account) use the same list shipped inside the app (js/wheel.js, WHEEL_PRIZES): change both to keep them equal.
--
-- DAYS: like the free coins, the app sends the player's LOCAL date; the server accepts a date within one day of its own UTC date
-- (covers every time zone) and the free spin needs a date later than the last free day.

create table if not exists public.wheel_prizes (
  id        text primary key,
  label     text not null,
  kind      text not null check (kind in ('coins', 'hint', 'skip')),
  amount    integer not null default 1 check (amount between 1 and 1000),
  hint_type text check (hint_type in ('reveal', 'remove', 'word')),
  weight    integer not null check (weight >= 0),
  sort      integer not null,
  enabled   boolean not null default true,
  constraint wp_hint check ((kind = 'hint') = (hint_type is not null))
);
insert into public.wheel_prizes (id, label, kind, amount, hint_type, weight, sort) values
  ('c25',          '+25 Coins',        'coins', 25,  null,     26, 1),
  ('hint_reveal',  'Reveal Letter',    'hint',  1,   'reveal', 14, 2),
  ('c50',          '+50 Coins',        'coins', 50,  null,     20, 3),
  ('skip',         'Skip',             'skip',  1,   null,     12, 4),
  ('hint_word',    'Clue',             'hint',  1,   'word',   12, 5),
  ('c100',         '+100 Coins',       'coins', 100, null,      9, 6),
  ('hint_remove',  'Remove Wrong',     'hint',  1,   'remove',  6, 7),
  ('c250',         'JACKPOT +250',     'coins', 250, null,      1, 8)
on conflict (id) do nothing;

create table if not exists public.wheel_state (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  last_free_day date,
  total_spins   integer not null default 0,
  updated_at    timestamptz not null default now()
);

create table if not exists public.wheel_spins (
  id         uuid primary key,                                   -- the request id sent by the app (one spin per id)
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  free       boolean not null,
  cost       integer not null,
  prize_id   text not null,
  created_at timestamptz not null default now()
);
create index if not exists ws_user_idx on public.wheel_spins (user_id, created_at desc);

alter table public.wheel_prizes enable row level security;
alter table public.wheel_state  enable row level security;
alter table public.wheel_spins  enable row level security;
drop policy if exists "prizes are public" on public.wheel_prizes;
create policy "prizes are public" on public.wheel_prizes for select to anon, authenticated using (enabled);
drop policy if exists "read own wheel state" on public.wheel_state;
create policy "read own wheel state" on public.wheel_state for select to authenticated using (user_id = auth.uid());
drop policy if exists "read own spins" on public.wheel_spins;
create policy "read own spins" on public.wheel_spins for select to authenticated using (user_id = auth.uid());
-- no insert / update / delete policies on purpose: only the functions below can change anything
revoke insert, update, delete on public.wheel_prizes, public.wheel_state, public.wheel_spins from anon, authenticated;

-- ---------------------------------------------------------------- the prize list the wheel is drawn from
create or replace function public.wheel_config() returns json
language sql security definer stable set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', id, 'label', label, 'kind', kind, 'amount', amount, 'hint', hint_type) order by sort), '[]'::json)
    from public.wheel_prizes where enabled;
$$;

-- ---------------------------------------------------------------- spin
create or replace function public.spin_wheel(p_req uuid, p_day date, p_allow_paid boolean default false) returns json
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  st public.wheel_state%rowtype; sp public.wheel_spins%rowtype; pz public.wheel_prizes%rowtype; picked public.wheel_prizes%rowtype;
  is_free boolean; total integer; roll integer; acc integer := 0; found_prize boolean := false;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_req is null or p_day is null then return json_build_object('ok', false, 'reason', 'bad_request'); end if;

  -- the same request again (retry, double tap, refresh): the stored result, never a new prize
  select * into sp from public.wheel_spins where id = p_req;
  if found then
    if sp.user_id <> uid then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
    select * into pz from public.wheel_prizes where id = sp.prize_id;
    return json_build_object('ok', true, 'replay', true, 'prize', json_build_object('id', pz.id, 'label', pz.label, 'kind', pz.kind, 'amount', pz.amount, 'hint', pz.hint_type),
                             'free', sp.free, 'cost', sp.cost, 'day', sp.day);
  end if;

  if p_day < utc_today - 1 or p_day > utc_today + 1 then return json_build_object('ok', false, 'reason', 'bad_day'); end if;

  insert into public.wheel_state (user_id) values (uid) on conflict (user_id) do nothing;
  select * into st from public.wheel_state where user_id = uid for update;               -- one spin at a time per player
  if (select count(*) from public.wheel_spins where user_id = uid and created_at > now() - interval '24 hours') >= 200 then
    return json_build_object('ok', false, 'reason', 'limit');
  end if;

  if st.last_free_day is null or st.last_free_day < p_day then is_free := true;
  elsif p_allow_paid then is_free := false;
  else return json_build_object('ok', false, 'reason', 'free_used', 'last_free_day', st.last_free_day); end if;

  select coalesce(sum(weight), 0) into total from public.wheel_prizes where enabled and weight > 0;
  if total <= 0 then return json_build_object('ok', false, 'reason', 'no_prizes'); end if;
  roll := floor(random() * total)::int;                                                  -- 0 .. total-1
  for pz in select * from public.wheel_prizes where enabled and weight > 0 order by sort loop
    acc := acc + pz.weight;
    if roll < acc then picked := pz; found_prize := true; exit; end if;
  end loop;
  if not found_prize then return json_build_object('ok', false, 'reason', 'no_prizes'); end if;

  insert into public.wheel_spins (id, user_id, day, free, cost, prize_id) values (p_req, uid, p_day, is_free, case when is_free then 0 else 50 end, picked.id);
  update public.wheel_state set last_free_day = case when is_free then p_day else last_free_day end, total_spins = total_spins + 1, updated_at = now() where user_id = uid;
  return json_build_object('ok', true, 'replay', false, 'prize', json_build_object('id', picked.id, 'label', picked.label, 'kind', picked.kind, 'amount', picked.amount, 'hint', picked.hint_type),
                           'free', is_free, 'cost', case when is_free then 0 else 50 end, 'day', p_day);
end $$;

-- A spin whose result never reached the app (closed or crashed mid-spin) is fetched again by its request id.
create or replace function public.wheel_result(p_req uuid) returns json
language plpgsql security definer stable set search_path = '' as $$
declare uid uuid := auth.uid(); sp public.wheel_spins%rowtype; pz public.wheel_prizes%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into sp from public.wheel_spins where id = p_req and user_id = uid;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into pz from public.wheel_prizes where id = sp.prize_id;
  return json_build_object('ok', true, 'prize', json_build_object('id', pz.id, 'label', pz.label, 'kind', pz.kind, 'amount', pz.amount, 'hint', pz.hint_type),
                           'free', sp.free, 'cost', sp.cost, 'day', sp.day);
end $$;

-- Free-spin status + the last 10 spins, the same on every device.
create or replace function public.wheel_status() returns json
language plpgsql security definer stable set search_path = '' as $$
declare uid uuid := auth.uid(); d date; h json;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select last_free_day into d from public.wheel_state where user_id = uid;
  select coalesce(json_agg(t order by t.ts desc), '[]'::json) into h from (
    select s.prize_id as prize, s.free, s.cost, s.created_at as ts from public.wheel_spins s where s.user_id = uid order by s.created_at desc limit 10) t;
  return json_build_object('last_free_day', d, 'history', h);
end $$;

revoke all on function public.wheel_config() from public, anon, authenticated;
revoke all on function public.spin_wheel(uuid, date, boolean) from public, anon, authenticated;
revoke all on function public.wheel_result(uuid) from public, anon, authenticated;
revoke all on function public.wheel_status() from public, anon, authenticated;
grant execute on function public.wheel_config() to anon, authenticated;
grant execute on function public.spin_wheel(uuid, date, boolean) to authenticated;
grant execute on function public.wheel_result(uuid) to authenticated;
grant execute on function public.wheel_status() to authenticated;
