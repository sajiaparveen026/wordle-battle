-- Wordle Battle: Friend Battle (private 1v1 rooms), decided entirely by the server.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Then run 006b_battle_words.sql and 006c_battle_clues.sql (the word lists the server needs).
--
-- HOW IT IS PROTECTED
--  * Every table has Row Level Security ON, NO policies and NO grants: the app can never read or write them directly.
--    So the secret word, the opponent's guesses and every player's identity key can never be fetched by a browser.
--  * The only doors are the bt_* functions below. They check who is calling (a signed-in account, or a guest id + secret
--    kept on the device, exactly like the leaderboard), and they decide everything: the word, the clock, guesses, hints,
--    the winner and the rewards. Browsers only send input and show what the server returns.
--  * Live updates use Supabase Realtime BROADCAST: when a room changes, the database sends a tiny "tick" (no game data)
--    on the channel `battle:<room id>`, and each browser then asks bt_sync for its own private view.
--  * Every action first locks the room row, so two players acting at the same instant are processed one after the other.
--
-- TIMING: there is no always-on server job. Timeouts, disconnect forfeits and expired rooms are applied by the next
-- request for that room (every connected player polls every few seconds). If both players vanish, the room is cleaned up later.

-- ---------------------------------------------------------------- word lists (filled by 006b / 006c)
create table if not exists public.battle_words (
  word      text primary key check (word ~ '^[a-z]{5}$'),
  is_answer boolean not null default false,     -- can be picked as a secret word
  clue      jsonb                               -- [["meaning","..."],["related","..."],["usage","..."]] for answer words
);
alter table public.battle_words enable row level security;
revoke all on public.battle_words from public, anon, authenticated;

-- ---------------------------------------------------------------- rooms
create table if not exists public.battle_rooms (
  id               uuid primary key default gen_random_uuid(),
  room_code        text not null unique check (room_code ~ '^[A-Z0-9]{6}$'),
  host_user_id     uuid references auth.users(id) on delete set null,   -- set when the host is a registered player
  host_guest_pid   uuid,                                                 -- set when the host is a guest
  difficulty       text not null check (difficulty in ('easy','medium','hard')),
  duration_seconds int  not null check (duration_seconds in (720, 480, 300)),
  status           text not null default 'waiting'
                   check (status in ('waiting','lobby','playing','finished','cancelled','expired')),
  secret_word      text check (secret_word ~ '^[a-z]{5}$'),             -- never leaves the database until the battle ends
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,                                 -- unjoined / un-started rooms die here
  started_at       timestamptz,                                          -- first moment guesses are accepted
  ends_at          timestamptz,                                          -- started_at + duration (the server's clock is the only clock)
  completed_at     timestamptz,
  winner_player_id uuid,
  result           text check (result in ('win','draw')),
  end_reason       text check (end_reason in ('solved','failed','timeout','forfeit','abandoned')),
  prev_room_id     uuid references public.battle_rooms(id) on delete set null,
  version          int  not null default 0                               -- bumped on every change
);
create index if not exists battle_rooms_status_idx on public.battle_rooms (status, created_at);
alter table public.battle_rooms enable row level security;
revoke all on public.battle_rooms from public, anon, authenticated;

-- ---------------------------------------------------------------- players
create table if not exists public.battle_players (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.battle_rooms(id) on delete cascade,
  seat              int  not null check (seat in (1, 2)),                -- 1 = host
  user_id           uuid references auth.users(id) on delete cascade,    -- registered player
  guest_pid         uuid,                                                -- guest id (chosen by the guest's device)
  key_hash          text,                                                -- sha256 of the guest's secret; never shown
  username          text not null,
  avatar            text not null default '🦊' check (char_length(avatar) between 1 and 8),
  is_ready          boolean not null default false,
  connection_status text not null default 'connected' check (connection_status in ('connected','left')),
  last_seen         timestamptz not null default now(),
  attempts_used     int  not null default 0 check (attempts_used between 0 and 6),
  player_status     text not null default 'active' check (player_status in ('active','solved','failed')),
  best_exact        int  not null default 0,                             -- best guess so far: right letter, right place
  best_present      int  not null default 0,                             --                   right letter, wrong place
  hints_used        text[] not null default '{}',
  hint_data         jsonb  not null default '{}'::jsonb,                 -- what each used hint showed (so a refresh restores it)
  completion_ms     int,
  outcome           text check (outcome in ('win','loss','draw','forfeit')),
  reward_claimed    boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (room_id, seat),
  constraint bp_owner check ((user_id is not null and guest_pid is null and key_hash is null)
                          or (user_id is null and guest_pid is not null and key_hash is not null))
);
create unique index if not exists bp_room_user_key  on public.battle_players (room_id, user_id)   where user_id is not null;
create unique index if not exists bp_room_guest_key on public.battle_players (room_id, guest_pid) where guest_pid is not null;
create index if not exists bp_user_idx  on public.battle_players (user_id)   where user_id is not null;
create index if not exists bp_guest_idx on public.battle_players (guest_pid) where guest_pid is not null;
alter table public.battle_players enable row level security;
revoke all on public.battle_players from public, anon, authenticated;

-- ---------------------------------------------------------------- private guess log
create table if not exists public.battle_guesses (
  room_id    uuid not null references public.battle_rooms(id) on delete cascade,
  player_id  uuid not null references public.battle_players(id) on delete cascade,
  n          int  not null check (n between 1 and 6),
  word       text not null,
  pattern    text not null check (pattern ~ '^[gyx]{5}$'),               -- g = right place, y = wrong place, x = not in the word
  created_at timestamptz not null default now(),
  primary key (player_id, n)
);
alter table public.battle_guesses enable row level security;
revoke all on public.battle_guesses from public, anon, authenticated;

-- ---------------------------------------------------------------- rematch requests
create table if not exists public.battle_rematches (
  id                   uuid primary key default gen_random_uuid(),
  previous_room_id     uuid not null references public.battle_rooms(id) on delete cascade,
  requesting_player_id uuid not null references public.battle_players(id) on delete cascade,
  accepting_player_id  uuid references public.battle_players(id) on delete set null,
  status               text not null default 'pending' check (status in ('pending','accepted','declined','expired')),
  expires_at           timestamptz not null,
  new_room_id          uuid references public.battle_rooms(id) on delete set null,
  created_at           timestamptz not null default now()
);
-- only one open request per finished battle, and only one accepted rematch (no duplicate battles)
create unique index if not exists br_one_pending  on public.battle_rematches (previous_room_id) where status = 'pending';
create unique index if not exists br_one_accepted on public.battle_rematches (previous_room_id) where status = 'accepted';
alter table public.battle_rematches enable row level security;
revoke all on public.battle_rematches from public, anon, authenticated;

-- ================================================================ internal helpers (not callable from the app)

-- Standard Wordle colouring (handles repeated letters correctly). g / y / x per letter.
create or replace function public.bt_pattern(p_guess text, p_answer text) returns text
language plpgsql immutable set search_path = '' as $$
declare res text[] := array['x','x','x','x','x']; cnt int[] := array_fill(0, array[26]); i int; c int;
begin
  for i in 1..5 loop
    if substr(p_guess, i, 1) = substr(p_answer, i, 1) then res[i] := 'g';
    else c := ascii(substr(p_answer, i, 1)) - 96; cnt[c] := cnt[c] + 1; end if;
  end loop;
  for i in 1..5 loop
    if res[i] = 'x' then
      c := ascii(substr(p_guess, i, 1)) - 96;
      if cnt[c] > 0 then res[i] := 'y'; cnt[c] := cnt[c] - 1; end if;
    end if;
  end loop;
  return array_to_string(res, '');
end $$;

-- Coins and XP for an outcome. Someone who walks away (forfeit) earns nothing.
create or replace function public.bt_reward(p_outcome text, out coins int, out xp int) returns record
language sql immutable set search_path = '' as $$
  select case p_outcome when 'win' then 30 when 'loss' then 10 when 'draw' then 15 else 0 end,
         case p_outcome when 'win' then 50 when 'loss' then 15 when 'draw' then 25 else 0 end;
$$;

-- Who is calling? A signed-in account, or a guest id + secret (hashed here, never stored in clear).
create or replace function public.bt_actor(p_pid uuid, p_secret text, out uid uuid, out h text, out ok boolean) returns record
language plpgsql stable set search_path = '' as $$
begin
  uid := auth.uid(); ok := false;
  if uid is not null then ok := true; return; end if;
  if p_pid is null or p_secret is null or char_length(p_secret) < 24 or char_length(p_secret) > 100 then return; end if;
  h := encode(sha256(convert_to(p_secret, 'utf8')), 'hex'); ok := true;
end $$;

-- The caller's player row in a room (an all-NULL row when the caller is not in that room).
create or replace function public.bt_mine(p_room uuid, p_pid uuid, p_secret text) returns public.battle_players
language plpgsql security definer stable set search_path = '' as $$
declare a record; pl public.battle_players%rowtype;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return pl; end if;
  if a.uid is not null then
    select * into pl from public.battle_players where room_id = p_room and user_id = a.uid;
  else
    select * into pl from public.battle_players where room_id = p_room and guest_pid = p_pid and key_hash = a.h;
  end if;
  return pl;
end $$;

-- Display name + avatar. Accounts: copied from their profile (the app cannot choose them). Guests: validated.
create or replace function public.bt_identity(p_username text, p_avatar text, out uname text, out av text) returns record
language plpgsql security definer set search_path = '' as $$
declare prof record;
begin
  if auth.uid() is not null then
    select username, avatar into prof from public.profiles where id = auth.uid();
    if found then uname := prof.username; av := prof.avatar; return; end if;
  end if;
  uname := case when p_username is not null and p_username ~ '^[A-Za-z0-9_]{3,16}$' then p_username
                else 'Player' || (1000 + floor(random() * 9000))::int end;
  av := case when p_avatar is not null and char_length(p_avatar) between 1 and 8 then p_avatar else '🦊' end;
end $$;

-- Tell everyone watching the room "something changed" (no game data in it). Never fails the caller.
create or replace function public.bt_notify(p_room uuid, p_version int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('v', p_version), 'tick', 'battle:' || p_room::text, false);
exception when others then null;
end $$;

create or replace function public.bt_bump(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  update public.battle_rooms set version = version + 1 where id = p_room returning version into v;
  if v is not null then perform public.bt_notify(p_room, v); end if;
end $$;

-- End a battle exactly once. p_winner NULL = draw. A forfeiter earns nothing.
create or replace function public.bt_finish(p_room uuid, p_winner uuid, p_reason text, p_forfeiter uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  update public.battle_rooms
     set status = 'finished', completed_at = clock_timestamp(), winner_player_id = p_winner,
         result = case when p_winner is null then 'draw' else 'win' end, end_reason = p_reason, version = version + 1
   where id = p_room and status = 'playing'
   returning version into v;
  if v is null then return; end if;                      -- already finished by someone else: nothing to do
  if p_winner is null then
    update public.battle_players set outcome = 'draw' where room_id = p_room;
  else
    update public.battle_players
       set outcome = case when id = p_winner then 'win' when id = p_forfeiter then 'forfeit' else 'loss' end
     where room_id = p_room;
  end if;
  perform public.bt_notify(p_room, v);
end $$;

-- Lock the room and apply anything that is now due: expired rooms, absent players, the timer running out,
-- stale rematch requests. Every public function calls this first, so the server's clock is the only clock.
create or replace function public.bt_settle(p_room uuid) returns public.battle_rooms
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; a public.battle_players%rowtype; b public.battle_players%rowtype; changed boolean := false;
begin
  select * into r from public.battle_rooms where id = p_room for update;
  if not found then return r; end if;

  update public.battle_rematches set status = 'expired' where previous_room_id = r.id and status = 'pending' and expires_at < clock_timestamp();
  if found then changed := true; end if;

  if r.status in ('waiting', 'lobby') then
    if r.expires_at < clock_timestamp()
       or exists (select 1 from public.battle_players p where p.room_id = r.id and p.seat = 1 and p.last_seen < clock_timestamp() - interval '75 seconds') then
      update public.battle_rooms set status = 'expired', version = version + 1 where id = r.id;
      changed := true;
    elsif r.status = 'lobby'
       and exists (select 1 from public.battle_players p where p.room_id = r.id and p.seat = 2 and p.last_seen < clock_timestamp() - interval '75 seconds') then
      delete from public.battle_players where room_id = r.id and seat = 2;      -- the guest vanished: the room waits again
      update public.battle_players set is_ready = false where room_id = r.id;
      update public.battle_rooms set status = 'waiting', version = version + 1 where id = r.id;
      changed := true;
    end if;

  elsif r.status = 'playing' then
    select * into a from public.battle_players where room_id = r.id and seat = 1;
    select * into b from public.battle_players where room_id = r.id and seat = 2;
    if clock_timestamp() >= r.ends_at then
      -- time is up: best guess wins (right place first, then wrong place); still level = draw
      if (a.best_exact, a.best_present) > (b.best_exact, b.best_present) then perform public.bt_finish(r.id, a.id, 'timeout');
      elsif (b.best_exact, b.best_present) > (a.best_exact, a.best_present) then perform public.bt_finish(r.id, b.id, 'timeout');
      else perform public.bt_finish(r.id, null, 'timeout'); end if;
    else
      -- a still-playing player who has been silent for 75 s (15 s grace + 60 s to come back) forfeits
      declare a_gone boolean := a.player_status = 'active' and a.last_seen < clock_timestamp() - interval '75 seconds';
              b_gone boolean := b.player_status = 'active' and b.last_seen < clock_timestamp() - interval '75 seconds';
      begin
        if a_gone and b_gone then perform public.bt_finish(r.id, null, 'abandoned');
        elsif a_gone then
          if b.player_status = 'failed' then perform public.bt_finish(r.id, null, 'abandoned'); else perform public.bt_finish(r.id, b.id, 'forfeit', a.id); end if;
        elsif b_gone then
          if a.player_status = 'failed' then perform public.bt_finish(r.id, null, 'abandoned'); else perform public.bt_finish(r.id, a.id, 'forfeit', b.id); end if;
        end if;
      end;
    end if;
  end if;

  if changed then perform public.bt_bump(r.id); end if;
  select * into r from public.battle_rooms where id = p_room;
  return r;
end $$;

-- Delete old rooms (their players, guesses and rematches go with them). Called whenever someone creates a room.
create or replace function public.bt_cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.battle_rooms
   where (status in ('expired', 'cancelled') and created_at < now() - interval '1 hour')
      or (status in ('waiting', 'lobby') and expires_at < now() - interval '1 hour')
      or (status = 'playing' and ends_at < now() - interval '1 hour')
      or (status = 'finished' and completed_at < now() - interval '3 days');
$$;

-- What a player is allowed to see. Own guesses and hints in full; the opponent's only as counts until the battle ends.
create or replace function public.bt_view(r public.battle_rooms, me public.battle_players) returns json
language plpgsql security definer stable set search_path = '' as $$
declare fin boolean := (r.status = 'finished'); players json; my_guesses json; opp_patterns json; rm record; rematch json; reward json; rw record;
begin
  select json_agg(json_build_object(
           'id', p.id, 'seat', p.seat, 'username', p.username, 'avatar', p.avatar, 'is_me', (p.id = me.id),
           'ready', p.is_ready,
           'connection', case when p.connection_status = 'left' then 'left'
                              when p.last_seen > clock_timestamp() - interval '15 seconds' then 'connected'
                              when p.last_seen > clock_timestamp() - interval '75 seconds' then 'reconnecting'
                              else 'disconnected' end,
           'reconnect_ms', greatest(0, (extract(epoch from (p.last_seen + interval '75 seconds' - clock_timestamp())) * 1000)::bigint),
           'attempts_used', p.attempts_used, 'status', p.player_status, 'outcome', p.outcome,
           'completion_ms', p.completion_ms,
           'best_exact',   case when fin or p.id = me.id then p.best_exact end,
           'best_present', case when fin or p.id = me.id then p.best_present end
         ) order by p.seat) into players
    from public.battle_players p where p.room_id = r.id;

  select coalesce(json_agg(json_build_object('word', g.word, 'pattern', g.pattern) order by g.n), '[]'::json) into my_guesses
    from public.battle_guesses g where g.player_id = me.id;
  select case when fin then coalesce(json_agg(g.pattern order by g.n), '[]'::json) end into opp_patterns
    from public.battle_guesses g where g.room_id = r.id and g.player_id <> me.id;

  select * into rm from public.battle_rematches where previous_room_id = r.id order by created_at desc limit 1;
  if found then
    rematch := json_build_object('status', rm.status, 'requested_by_me', (rm.requesting_player_id = me.id),
                                 'expires_in_ms', greatest(0, (extract(epoch from (rm.expires_at - clock_timestamp())) * 1000)::bigint),
                                 'new_room_id', rm.new_room_id);
  end if;

  if fin and me.outcome is not null then
    select * into rw from public.bt_reward(me.outcome);
    reward := json_build_object('coins', rw.coins, 'xp', rw.xp, 'claimed', me.reward_claimed);
  end if;

  return json_build_object(
    'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'room', json_build_object(
        'id', r.id, 'code', r.room_code, 'difficulty', r.difficulty, 'duration_seconds', r.duration_seconds,
        'status', r.status, 'version', r.version,
        'started_at_ms', (extract(epoch from r.started_at) * 1000)::bigint,
        'ends_at_ms',    (extract(epoch from r.ends_at) * 1000)::bigint,
        'expires_at_ms', (extract(epoch from r.expires_at) * 1000)::bigint,
        'winner_player_id', r.winner_player_id, 'result', r.result, 'end_reason', r.end_reason),
    'players', coalesce(players, '[]'::json),
    'me', json_build_object('id', me.id, 'seat', me.seat, 'guesses', my_guesses, 'hints_used', to_json(me.hints_used),
                            'hint_data', me.hint_data, 'reward', reward),
    'answer', case when fin then r.secret_word end,
    'opponent_patterns', opp_patterns,
    'rematch', rematch);
end $$;

-- Start a battle in a room (word chosen here, by the server). Both players start together after a 3-second countdown.
create or replace function public.bt_start(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare w text; r public.battle_rooms%rowtype; st timestamptz := clock_timestamp() + interval '3 seconds';
begin
  select word into w from public.battle_words where is_answer order by random() limit 1;
  if w is null then raise exception 'battle word list is empty - run 006b_battle_words.sql'; end if;
  select * into r from public.battle_rooms where id = p_room;
  update public.battle_players
     set attempts_used = 0, player_status = 'active', best_exact = 0, best_present = 0, hints_used = '{}', hint_data = '{}'::jsonb,
         completion_ms = null, outcome = null, is_ready = true
   where room_id = p_room;
  update public.battle_rooms
     set status = 'playing', secret_word = w, started_at = st, ends_at = st + make_interval(secs => r.duration_seconds),
         expires_at = st + make_interval(secs => r.duration_seconds + 3600), version = version + 1
   where id = p_room;
end $$;

revoke all on function public.bt_pattern(text, text) from public, anon, authenticated;
revoke all on function public.bt_reward(text) from public, anon, authenticated;
revoke all on function public.bt_actor(uuid, text) from public, anon, authenticated;
revoke all on function public.bt_mine(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bt_identity(text, text) from public, anon, authenticated;
revoke all on function public.bt_notify(uuid, int) from public, anon, authenticated;
revoke all on function public.bt_bump(uuid) from public, anon, authenticated;
revoke all on function public.bt_finish(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.bt_settle(uuid) from public, anon, authenticated;
revoke all on function public.bt_cleanup() from public, anon, authenticated;
revoke all on function public.bt_view(public.battle_rooms, public.battle_players) from public, anon, authenticated;
revoke all on function public.bt_start(uuid) from public, anon, authenticated;

-- ================================================================ public doors (these are what the app calls)
-- Every function takes the guest's id + secret (p_pid, p_secret); signed-in accounts leave them empty.

-- Create a room. Returns the room code, or the room you are already in.
create or replace function public.bt_create_room(p_difficulty text, p_pid uuid default null, p_secret text default null,
                                                 p_username text default null, p_avatar text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; ident record; secs int; code text; rid uuid; mine record; r public.battle_rooms%rowtype; pl public.battle_players%rowtype;
        alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; tries int := 0; i int;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  secs := case p_difficulty when 'easy' then 720 when 'medium' then 480 when 'hard' then 300 end;
  if secs is null then return json_build_object('ok', false, 'reason', 'bad_difficulty'); end if;
  perform public.bt_cleanup();

  -- already in an unfinished battle? settle it, and if it is still alive send the player back to it
  for mine in
    select r2.id from public.battle_rooms r2 join public.battle_players p on p.room_id = r2.id
     where r2.status in ('waiting', 'lobby', 'playing')
       and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
  loop
    r := public.bt_settle(mine.id);
    if r.status in ('waiting', 'lobby', 'playing') then
      return json_build_object('ok', false, 'reason', 'already_in_room', 'room_id', r.id, 'status', r.status, 'code', r.room_code);
    end if;
  end loop;

  if (select count(*) from public.battle_rooms
       where created_at > now() - interval '1 minute'
         and ((a.uid is not null and host_user_id = a.uid) or (a.uid is null and host_guest_pid = p_pid))) >= 5 then
    return json_build_object('ok', false, 'reason', 'throttled');
  end if;

  select * into ident from public.bt_identity(p_username, p_avatar);
  loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
    begin
      insert into public.battle_rooms (room_code, host_user_id, host_guest_pid, difficulty, duration_seconds, expires_at)
      values (code, a.uid, case when a.uid is null then p_pid end, p_difficulty, secs, now() + interval '10 minutes')
      returning id into rid;
      exit;
    exception when unique_violation then
      tries := tries + 1; if tries > 20 then return json_build_object('ok', false, 'reason', 'try_again'); end if;
    end;
  end loop;

  insert into public.battle_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar)
  values (rid, 1, a.uid, case when a.uid is null then p_pid end, a.h, ident.uname, ident.av) returning * into pl;
  select * into r from public.battle_rooms where id = rid;
  return json_build_object('ok', true, 'state', public.bt_view(r, pl));
end $$;

-- Join with a room code.
create or replace function public.bt_join_room(p_code text, p_pid uuid default null, p_secret text default null,
                                               p_username text default null, p_avatar text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; ident record; code text; rid uuid; mine record; r public.battle_rooms%rowtype; pl public.battle_players%rowtype;
        host_name text; uname text;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(code) <> 6 then return json_build_object('ok', false, 'reason', 'invalid_code'); end if;
  select id into rid from public.battle_rooms where room_code = code;
  if rid is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;

  r := public.bt_settle(rid);                                  -- locks the room: two joiners are handled one at a time
  pl := public.bt_mine(rid, p_pid, p_secret);
  if pl.id is not null then                                    -- already in this room (rejoin after a refresh)
    update public.battle_players set last_seen = clock_timestamp(), connection_status = 'connected' where id = pl.id;
    return json_build_object('ok', true, 'state', public.bt_view(r, pl));
  end if;

  if r.status = 'expired' then return json_build_object('ok', false, 'reason', 'expired'); end if;
  if r.status = 'cancelled' then return json_build_object('ok', false, 'reason', 'cancelled'); end if;
  if r.status = 'finished' then return json_build_object('ok', false, 'reason', 'finished'); end if;
  if r.status = 'playing' then return json_build_object('ok', false, 'reason', 'started'); end if;
  if r.status <> 'waiting' then return json_build_object('ok', false, 'reason', 'full'); end if;

  for mine in
    select r2.id from public.battle_rooms r2 join public.battle_players p on p.room_id = r2.id
     where r2.status in ('waiting', 'lobby', 'playing') and r2.id <> rid
       and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
  loop
    if (public.bt_settle(mine.id)).status in ('waiting', 'lobby', 'playing') then
      return json_build_object('ok', false, 'reason', 'busy', 'room_id', mine.id);
    end if;
  end loop;

  select * into ident from public.bt_identity(p_username, p_avatar);
  uname := ident.uname;
  select username into host_name from public.battle_players where room_id = rid and seat = 1;
  if lower(host_name) = lower(uname) then uname := left(uname, 13) || '_2'; end if;

  insert into public.battle_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar)
  values (rid, 2, a.uid, case when a.uid is null then p_pid end, a.h, uname, ident.av) returning * into pl;
  update public.battle_rooms set status = 'lobby', expires_at = now() + interval '10 minutes', version = version + 1 where id = rid;
  update public.battle_players set is_ready = false where room_id = rid;
  perform public.bt_bump(rid);
  select * into r from public.battle_rooms where id = rid;
  return json_build_object('ok', true, 'state', public.bt_view(r, pl));
end $$;

-- Heartbeat + poll + restore: call every few seconds and after a refresh. Marks me connected and returns my private view.
create or replace function public.bt_sync(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; pl public.battle_players%rowtype; was_conn boolean;
begin
  pl := public.bt_mine(p_room, p_pid, p_secret);
  if pl.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  was_conn := pl.connection_status = 'connected' and pl.last_seen > clock_timestamp() - interval '15 seconds';
  update public.battle_players set last_seen = clock_timestamp(), connection_status = 'connected' where id = pl.id;
  r := public.bt_settle(p_room);
  if not was_conn and r.status in ('lobby', 'playing') then perform public.bt_bump(p_room); end if;
  select * into pl from public.battle_players where id = pl.id;
  select * into r from public.battle_rooms where id = p_room;
  return json_build_object('ok', true, 'state', public.bt_view(r, pl));
end $$;

-- Ready / not ready. When both players are ready and connected the server starts the battle itself.
create or replace function public.bt_ready(p_room uuid, p_ready boolean, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; pl public.battle_players%rowtype; n int;
begin
  r := public.bt_settle(p_room);
  pl := public.bt_mine(p_room, p_pid, p_secret);
  if r.id is null or pl.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status = 'lobby' then
    update public.battle_players set is_ready = coalesce(p_ready, false), last_seen = clock_timestamp(), connection_status = 'connected' where id = pl.id;
    select count(*) into n from public.battle_players
     where room_id = r.id and is_ready and connection_status = 'connected' and last_seen > clock_timestamp() - interval '15 seconds';
    if n = 2 then perform public.bt_start(r.id); else perform public.bt_bump(r.id); end if;
  end if;
  select * into r from public.battle_rooms where id = p_room;
  select * into pl from public.battle_players where id = pl.id;
  return json_build_object('ok', r.status in ('lobby', 'playing'), 'reason', case when r.status in ('lobby', 'playing') then null else r.status end,
                           'state', public.bt_view(r, pl));
end $$;

-- Leave. Waiting room: host cancels it. Lobby: guest leaves (room waits again) or host cancels. Playing: leaving forfeits.
create or replace function public.bt_leave(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; pl public.battle_players%rowtype; opp public.battle_players%rowtype;
begin
  r := public.bt_settle(p_room);
  pl := public.bt_mine(p_room, p_pid, p_secret);
  if r.id is null or pl.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status = 'waiting' or (r.status = 'lobby' and pl.seat = 1) then
    update public.battle_rooms set status = 'cancelled', version = version + 1 where id = r.id;
    perform public.bt_bump(r.id);
  elsif r.status = 'lobby' then
    delete from public.battle_players where id = pl.id;
    update public.battle_players set is_ready = false where room_id = r.id;
    update public.battle_rooms set status = 'waiting', expires_at = now() + interval '10 minutes', version = version + 1 where id = r.id;
    perform public.bt_bump(r.id);
    return json_build_object('ok', true, 'left', true);
  elsif r.status = 'playing' then
    select * into opp from public.battle_players where room_id = r.id and id <> pl.id;
    update public.battle_players set connection_status = 'left' where id = pl.id;
    if pl.player_status = 'active' then                         -- walking away mid-game forfeits (a player who already failed just leaves)
      if opp.player_status = 'failed' then perform public.bt_finish(r.id, null, 'abandoned');
      else perform public.bt_finish(r.id, opp.id, 'forfeit', pl.id); end if;
    else
      perform public.bt_bump(r.id);
    end if;
  else
    update public.battle_players set connection_status = 'left' where id = pl.id;
    perform public.bt_bump(r.id);
  end if;
  select * into r from public.battle_rooms where id = p_room;
  select * into pl from public.battle_players where id = pl.id;
  return json_build_object('ok', true, 'state', public.bt_view(r, pl));
end $$;

-- Submit a guess. The server checks the word, colours it, keeps the score and decides the winner.
create or replace function public.bt_guess(p_room uuid, p_guess text, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; me public.battle_players%rowtype; opp public.battle_players%rowtype;
        g text := lower(coalesce(p_guess, '')); pat text; ex int; pr int; n int;
begin
  r := public.bt_settle(p_room);                               -- locks the room and applies timeouts first
  me := public.bt_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'playing' then
    return json_build_object('ok', false, 'reason', case when r.status = 'finished' then 'finished' else 'not_playing' end, 'state', public.bt_view(r, me));
  end if;
  if clock_timestamp() < r.started_at then return json_build_object('ok', false, 'reason', 'not_started', 'state', public.bt_view(r, me)); end if;
  if me.player_status <> 'active' or me.attempts_used >= 6 then return json_build_object('ok', false, 'reason', 'out', 'state', public.bt_view(r, me)); end if;
  if g !~ '^[a-z]{5}$' then return json_build_object('ok', false, 'reason', 'bad_length'); end if;
  if not exists (select 1 from public.battle_words where word = g) then return json_build_object('ok', false, 'reason', 'not_a_word'); end if;

  pat := public.bt_pattern(g, r.secret_word);
  ex := length(pat) - length(replace(pat, 'g', ''));
  pr := length(pat) - length(replace(pat, 'y', ''));
  n := me.attempts_used + 1;
  insert into public.battle_guesses (room_id, player_id, n, word, pattern) values (r.id, me.id, n, g, pat);
  update public.battle_players
     set attempts_used = n, last_seen = clock_timestamp(), connection_status = 'connected',
         best_exact   = case when (ex, pr) > (best_exact, best_present) then ex else best_exact end,
         best_present = case when (ex, pr) > (best_exact, best_present) then pr else best_present end,
         player_status = case when ex = 5 then 'solved' when n >= 6 then 'failed' else 'active' end,
         completion_ms = case when ex = 5 then (extract(epoch from clock_timestamp() - r.started_at) * 1000)::int end
   where id = me.id;

  if ex = 5 then
    perform public.bt_finish(r.id, me.id, 'solved');           -- first to solve wins on the spot
  else
    if n >= 6 then
      select * into opp from public.battle_players where room_id = r.id and id <> me.id;
      if opp.player_status = 'failed' then perform public.bt_finish(r.id, null, 'failed'); end if;
    end if;
    perform public.bt_bump(r.id);
  end if;
  select * into r from public.battle_rooms where id = p_room;
  select * into me from public.battle_players where id = me.id;
  return json_build_object('ok', true, 'pattern', pat, 'state', public.bt_view(r, me));
end $$;

-- Use a hint: 'reveal' (one letter), 'remove' (5 letters that are not in the word), 'word' (a clue). Once each per player.
create or replace function public.bt_hint(p_room uuid, p_type text, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; me public.battle_players%rowtype; pos int; letters text[]; clue jsonb; data jsonb;
begin
  r := public.bt_settle(p_room);
  me := public.bt_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_type not in ('reveal', 'remove', 'word') then return json_build_object('ok', false, 'reason', 'bad_type'); end if;
  if r.status <> 'playing' or clock_timestamp() < r.started_at or me.player_status <> 'active' then
    return json_build_object('ok', false, 'reason', 'not_playing', 'state', public.bt_view(r, me));
  end if;
  if p_type = any (me.hints_used) then return json_build_object('ok', false, 'reason', 'already_used', 'state', public.bt_view(r, me)); end if;

  if p_type = 'reveal' then
    select i into pos from generate_series(1, 5) i
     where not exists (select 1 from public.battle_guesses g where g.player_id = me.id and substr(g.word, i, 1) = substr(r.secret_word, i, 1))
     order by random() limit 1;
    if pos is null then return json_build_object('ok', false, 'reason', 'nothing_to_reveal'); end if;   -- not used up
    data := jsonb_build_object('pos', pos - 1, 'letter', substr(r.secret_word, pos, 1));
  elsif p_type = 'remove' then
    select coalesce(array_agg(l), '{}') into letters from (
      select chr(96 + i) as l from generate_series(1, 26) i
       where position(chr(96 + i) in r.secret_word) = 0
         and not exists (select 1 from public.battle_guesses g where g.player_id = me.id and position(chr(96 + i) in g.word) > 0)
       order by random() limit 5) s;
    if cardinality(letters) = 0 then return json_build_object('ok', false, 'reason', 'nothing_to_remove'); end if;
    data := jsonb_build_object('letters', to_jsonb(letters));
  else
    select c into clue from (select jsonb_array_elements(w.clue) as c from public.battle_words w where w.word = r.secret_word) s order by random() limit 1;
    if clue is null then return json_build_object('ok', false, 'reason', 'no_clue'); end if;
    data := jsonb_build_object('type', clue->>0, 'text', clue->>1);
  end if;

  update public.battle_players
     set hints_used = array_append(hints_used, p_type), hint_data = hint_data || jsonb_build_object(p_type, data),
         last_seen = clock_timestamp(), connection_status = 'connected'
   where id = me.id;
  select * into me from public.battle_players where id = me.id;
  return json_build_object('ok', true, 'type', p_type, 'data', data, 'state', public.bt_view(r, me));
end $$;

-- Claim my coins + XP for a finished battle. Pays exactly once: a refresh or a second tab gets granted = false.
create or replace function public.bt_claim_reward(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; me public.battle_players%rowtype; rw record; got uuid;
begin
  r := public.bt_settle(p_room);
  me := public.bt_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'finished' or me.outcome is null then return json_build_object('ok', false, 'reason', 'not_finished'); end if;
  select * into rw from public.bt_reward(me.outcome);
  update public.battle_players set reward_claimed = true where id = me.id and not reward_claimed returning id into got;
  return json_build_object('ok', true, 'granted', got is not null, 'coins', rw.coins, 'xp', rw.xp, 'outcome', me.outcome);
end $$;

-- Ask for a rematch. If the opponent already asked, this counts as accepting.
create or replace function public.bt_rematch_request(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; me public.battle_players%rowtype; opp public.battle_players%rowtype; pend public.battle_rematches%rowtype;
begin
  r := public.bt_settle(p_room);
  me := public.bt_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'finished' then return json_build_object('ok', false, 'reason', 'not_finished'); end if;
  select * into opp from public.battle_players where room_id = r.id and id <> me.id;
  if opp.id is null or opp.connection_status = 'left' then return json_build_object('ok', false, 'reason', 'opponent_left'); end if;
  if exists (select 1 from public.battle_rematches where previous_room_id = r.id and status = 'accepted') then
    return json_build_object('ok', false, 'reason', 'already_rematched');
  end if;
  select * into pend from public.battle_rematches where previous_room_id = r.id and status = 'pending';
  if found then
    if pend.requesting_player_id = me.id then
      return json_build_object('ok', true, 'state', public.bt_view(r, me));        -- duplicate click: nothing new
    end if;
    return public.bt_rematch_respond(p_room, true, p_pid, p_secret);                -- both want it
  end if;
  update public.battle_players set last_seen = clock_timestamp(), connection_status = 'connected' where id = me.id;
  insert into public.battle_rematches (previous_room_id, requesting_player_id, expires_at)
  values (r.id, me.id, clock_timestamp() + interval '30 seconds');
  perform public.bt_bump(r.id);
  select * into r from public.battle_rooms where id = p_room;
  return json_build_object('ok', true, 'state', public.bt_view(r, me));
end $$;

-- Accept or decline the opponent's rematch request. Accepting creates the new battle (fresh word, same difficulty).
create or replace function public.bt_rematch_respond(p_room uuid, p_accept boolean, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; me public.battle_players%rowtype; pend public.battle_rematches%rowtype; nr public.battle_rooms%rowtype;
        nid uuid; code text; alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int; tries int := 0;
begin
  r := public.bt_settle(p_room);
  me := public.bt_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into pend from public.battle_rematches
   where previous_room_id = r.id and status = 'pending' and requesting_player_id <> me.id for update;
  if not found then return json_build_object('ok', false, 'reason', 'no_request', 'state', public.bt_view(r, me)); end if;

  if not coalesce(p_accept, false) then
    update public.battle_rematches set status = 'declined', accepting_player_id = me.id where id = pend.id;
    perform public.bt_bump(r.id);
    select * into r from public.battle_rooms where id = p_room;
    return json_build_object('ok', true, 'declined', true, 'state', public.bt_view(r, me));
  end if;

  loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
    begin
      insert into public.battle_rooms (room_code, host_user_id, host_guest_pid, difficulty, duration_seconds, status, expires_at, prev_room_id)
      select code, r.host_user_id, r.host_guest_pid, r.difficulty, r.duration_seconds, 'lobby', now() + interval '10 minutes', r.id
      returning id into nid;
      exit;
    exception when unique_violation then
      tries := tries + 1; if tries > 20 then return json_build_object('ok', false, 'reason', 'try_again'); end if;
    end;
  end loop;
  insert into public.battle_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar)
  select nid, seat, user_id, guest_pid, key_hash, username, avatar from public.battle_players where room_id = r.id;
  perform public.bt_start(nid);                                  -- both agreed: fresh word, fresh attempts and hints, 3-second countdown
  update public.battle_rematches set status = 'accepted', accepting_player_id = me.id, new_room_id = nid where id = pend.id;
  perform public.bt_bump(r.id);
  select * into r from public.battle_rooms where id = p_room;
  return json_build_object('ok', true, 'accepted', true, 'new_room_id', nid, 'state', public.bt_view(r, me));
end $$;

-- After a refresh: which battle am I in, and is there a finished one whose reward I have not claimed yet?
create or replace function public.bt_get_active(p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare a record; rid uuid; r public.battle_rooms%rowtype; fin uuid; res json;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  select r2.id into rid from public.battle_rooms r2 join public.battle_players p on p.room_id = r2.id
   where r2.status in ('waiting', 'lobby', 'playing')
     and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
   order by r2.created_at desc limit 1;
  if rid is not null then
    r := public.bt_settle(rid);
    if r.status in ('waiting', 'lobby', 'playing') then
      res := json_build_object('room_id', r.id, 'status', r.status, 'code', r.room_code);
    end if;
  end if;
  select r2.id into fin from public.battle_rooms r2 join public.battle_players p on p.room_id = r2.id
   where r2.status = 'finished' and p.outcome in ('win', 'loss', 'draw') and not p.reward_claimed and r2.completed_at > now() - interval '3 days'
     and ((a.uid is not null and p.user_id = a.uid) or (a.uid is null and p.guest_pid = p_pid and p.key_hash = a.h))
   order by r2.completed_at desc limit 1;
  return json_build_object('ok', true, 'active', res, 'unclaimed_room_id', fin);
end $$;

-- A guest just created an account: move their battle identity to the account (so unclaimed rewards are not lost).
create or replace function public.bt_adopt_guest(p_pid uuid, p_secret text) returns json
language plpgsql security definer set search_path = '' as $$
declare h text; n int;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_pid is null or p_secret is null or char_length(p_secret) < 24 or char_length(p_secret) > 100 then return json_build_object('ok', false); end if;
  h := encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
  update public.battle_players p set user_id = auth.uid(), guest_pid = null, key_hash = null
   where p.guest_pid = p_pid and p.key_hash = h
     and not exists (select 1 from public.battle_players x where x.room_id = p.room_id and x.user_id = auth.uid());
  get diagnostics n = row_count;
  update public.battle_rooms set host_user_id = auth.uid(), host_guest_pid = null where host_guest_pid = p_pid;
  return json_build_object('ok', true, 'moved', n);
end $$;

revoke all on function public.bt_create_room(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.bt_join_room(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.bt_sync(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bt_ready(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.bt_leave(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bt_guess(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.bt_hint(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.bt_claim_reward(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bt_rematch_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bt_rematch_respond(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.bt_get_active(uuid, text) from public, anon, authenticated;
revoke all on function public.bt_adopt_guest(uuid, text) from public, anon, authenticated;
grant execute on function public.bt_create_room(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.bt_join_room(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.bt_sync(uuid, uuid, text) to anon, authenticated;
grant execute on function public.bt_ready(uuid, boolean, uuid, text) to anon, authenticated;
grant execute on function public.bt_leave(uuid, uuid, text) to anon, authenticated;
grant execute on function public.bt_guess(uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.bt_hint(uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.bt_claim_reward(uuid, uuid, text) to anon, authenticated;
grant execute on function public.bt_rematch_request(uuid, uuid, text) to anon, authenticated;
grant execute on function public.bt_rematch_respond(uuid, boolean, uuid, text) to anon, authenticated;
grant execute on function public.bt_get_active(uuid, text) to anon, authenticated;
grant execute on function public.bt_adopt_guest(uuid, text) to authenticated;