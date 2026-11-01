-- Wordle Battle: Team Zone gameplay (guesses, hints, solving, timeout, placements). Run AFTER 009_team_zone.sql.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- It replaces the tz_* functions that gameplay needs (create or replace). Friend Zone (bt_*) is NOT changed.
--
-- RULES (all decided here, never in the app)
--  * Everyone gets the same secret word and the same clock. Each player has 6 attempts and their own hint allowance.
--  * The first player to solve the word wins at once: the battle ends for everyone and the others stop.
--  * A player who uses all 6 attempts is out (player_status = 'failed'); the others keep playing.
--  * The battle also ends when the clock runs out, or when no player is still able to play.
--  * Placements: solvers first (by solve time). Everyone else is ranked by best progress: most right-place letters,
--    then most right-letter-wrong-place. Equal progress shares a place (a real tie is shown as a tie). Never random.
--  * A player who leaves mid-battle is out (failed, left_game = true). Their score stays on the board.

-- ---------------------------------------------------------------- new columns / tables
alter table public.tz_players add column if not exists left_game boolean not null default false;
alter table public.tz_rooms   add column if not exists end_reason text
  check (end_reason in ('solved', 'failed', 'timeout'));

-- Each guess, private to the room's rules (the opponents' letters are only shown once the battle is over).
create table if not exists public.tz_guesses (
  room_id    uuid not null references public.tz_rooms(id) on delete cascade,
  player_id  uuid not null references public.tz_players(id) on delete cascade,
  n          int  not null check (n between 1 and 6),
  word       text not null,
  pattern    text not null check (pattern ~ '^[gyx]{5}$'),
  created_at timestamptz not null default now(),
  primary key (player_id, n)
);
alter table public.tz_guesses enable row level security;
revoke all on public.tz_guesses from public, anon, authenticated;

-- ================================================================ internal helpers

-- End the battle exactly once and place everyone. Solvers first (fastest first); then best progress; equal = same place.
create or replace function public.tz_finish(p_room uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.tz_rooms
     set status = 'finished', completed_at = clock_timestamp(), end_reason = p_reason
   where id = p_room and status = 'playing';
  if not found then return; end if;

  update public.tz_players p
     set finish_place = x.place
    from (select id,
                 rank() over (order by (player_status = 'solved') desc,
                                       completion_ms asc nulls last,
                                       best_exact desc, best_present desc) as place
            from public.tz_players where room_id = p_room) x
   where p.id = x.id;

  perform public.tz_bump(p_room);
end $$;

-- Apply what is due: time up, or nobody left who can still play. Every public function calls this first.
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

  elsif r.status = 'playing' then
    if clock_timestamp() >= r.ends_at then
      perform public.tz_finish(r.id, 'timeout');
    elsif not exists (select 1 from public.tz_players p where p.room_id = r.id and p.player_status = 'active' and not p.left_game) then
      perform public.tz_finish(r.id, 'failed');
    end if;
  end if;

  select * into r from public.tz_rooms where id = p_room;
  return r;
end $$;

-- After a change: if nobody can still play, end the battle; otherwise just tell everyone.
create or replace function public.tz_after_change(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.tz_players p where p.room_id = p_room and p.player_status = 'active' and not p.left_game)
     and exists (select 1 from public.tz_rooms where id = p_room and status = 'playing') then
    perform public.tz_finish(p_room, 'failed');
  else
    perform public.tz_bump(p_room);
  end if;
end $$;

-- What a player may see. Own guesses and hints in full; everyone's letters only after the battle; counts while it runs.
create or replace function public.tz_view(r public.tz_rooms, me public.tz_players) returns json
language plpgsql security definer stable set search_path = '' as $$
declare players json; my_guesses json; fin boolean := (r.status = 'finished');
begin
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'seat', p.seat, 'username', p.username, 'avatar', p.avatar,
           'is_me', (p.id = me.id), 'is_host', (p.seat = 1), 'ready', p.is_ready,
           'connection', case when p.left_game then 'left'
                              when p.last_seen > clock_timestamp() - interval '15 seconds' then 'connected'
                              when p.last_seen > clock_timestamp() - interval '75 seconds' then 'reconnecting'
                              else 'disconnected' end,
           'attempts_used', p.attempts_used, 'status', p.player_status,
           'completion_ms', case when p.player_status = 'solved' or fin then p.completion_ms end,
           'finish_place', case when fin then p.finish_place end,
           'best_exact',   case when fin or p.id = me.id then p.best_exact end,
           'best_present', case when fin or p.id = me.id then p.best_present end
         ) order by p.seat), '[]'::json) into players
    from public.tz_players p where p.room_id = r.id;

  select coalesce(json_agg(json_build_object('word', g.word, 'pattern', g.pattern) order by g.n), '[]'::json) into my_guesses
    from public.tz_guesses g where g.player_id = me.id;

  return json_build_object(
    'server_now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'room', json_build_object(
        'id', r.id, 'code', r.room_code, 'difficulty', r.difficulty, 'duration_seconds', r.duration_seconds,
        'max_players', r.max_players, 'status', r.status, 'version', r.version, 'end_reason', r.end_reason,
        'started_at_ms', (extract(epoch from r.started_at) * 1000)::bigint,
        'ends_at_ms',    (extract(epoch from r.ends_at) * 1000)::bigint),
    'players', players,
    'me', json_build_object('id', me.id, 'seat', me.seat, 'is_host', (me.seat = 1),
                            'status', me.player_status, 'guesses', my_guesses,
                            'hints_used', to_json(me.hints_used), 'hint_data', me.hint_data),
    'answer', case when fin then r.secret_word end);
end $$;

-- Start: fresh attempts, hints and states for everyone. The server picks the word and the clock (3-second countdown).
create or replace function public.tz_start(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare w text; r public.tz_rooms%rowtype; st timestamptz := clock_timestamp() + interval '3 seconds';
begin
  select word into w from public.battle_words where is_answer order by random() limit 1;
  if w is null then raise exception 'battle word list is empty - run 006b_battle_words.sql'; end if;
  select * into r from public.tz_rooms where id = p_room;
  delete from public.tz_guesses where room_id = p_room;
  update public.tz_players
     set attempts_used = 0, player_status = 'active', best_exact = 0, best_present = 0, hints_used = '{}', hint_data = '{}'::jsonb,
         completion_ms = null, finish_place = null, reward_claimed = false, left_game = false, is_ready = true
   where room_id = p_room;
  update public.tz_rooms
     set status = 'playing', secret_word = w, started_at = st, ends_at = st + make_interval(secs => r.duration_seconds), end_reason = null
   where id = p_room;
  perform public.tz_bump(p_room);
end $$;

-- ================================================================ public doors

-- Submit a guess. Checked, coloured and scored here. The first correct guess ends the battle for everyone.
create or replace function public.tz_guess(p_room uuid, p_guess text, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; me public.tz_players%rowtype; g text := lower(coalesce(p_guess, ''));
        pat text; ex int; pr int; n int;
begin
  r := public.tz_settle(p_room);
  me := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.status <> 'playing' then
    return json_build_object('ok', false, 'reason', case when r.status = 'finished' then 'finished' else 'not_playing' end, 'state', public.tz_view(r, me));
  end if;
  if clock_timestamp() < r.started_at then return json_build_object('ok', false, 'reason', 'not_started', 'state', public.tz_view(r, me)); end if;
  if me.player_status <> 'active' or me.left_game or me.attempts_used >= 6 then
    return json_build_object('ok', false, 'reason', 'out', 'state', public.tz_view(r, me));
  end if;
  if g !~ '^[a-z]{5}$' then return json_build_object('ok', false, 'reason', 'bad_length'); end if;
  if not exists (select 1 from public.battle_words where word = g) then return json_build_object('ok', false, 'reason', 'not_a_word'); end if;
  if exists (select 1 from public.tz_guesses where player_id = me.id and word = g) then
    return json_build_object('ok', false, 'reason', 'already_guessed', 'state', public.tz_view(r, me));
  end if;

  pat := public.bt_pattern(g, r.secret_word);
  ex := length(pat) - length(replace(pat, 'g', ''));
  pr := length(pat) - length(replace(pat, 'y', ''));
  n := me.attempts_used + 1;
  insert into public.tz_guesses (room_id, player_id, n, word, pattern) values (r.id, me.id, n, g, pat);
  update public.tz_players
     set attempts_used = n, last_seen = clock_timestamp(),
         best_exact   = case when (ex, pr) > (best_exact, best_present) then ex else best_exact end,
         best_present = case when (ex, pr) > (best_exact, best_present) then pr else best_present end,
         player_status = case when ex = 5 then 'solved' when n >= 6 then 'failed' else 'active' end,
         completion_ms = case when ex = 5 then (extract(epoch from clock_timestamp() - r.started_at) * 1000)::int end
   where id = me.id;

  if ex = 5 then
    perform public.tz_finish(r.id, 'solved');                       -- first to solve wins; the battle stops for everyone
  else
    perform public.tz_after_change(r.id);
  end if;

  select * into r from public.tz_rooms where id = p_room;
  select * into me from public.tz_players where id = me.id;
  return json_build_object('ok', true, 'pattern', pat, 'state', public.tz_view(r, me));
end $$;

-- A hint, once per type per player: 'reveal' (one correct letter), 'remove' (5 letters not in the word), 'word' (a clue).
-- Each player's allowance is their own. Hints cost nothing extra.
create or replace function public.tz_hint(p_room uuid, p_type text, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; me public.tz_players%rowtype; pos int; letters text[]; clue jsonb; data jsonb;
begin
  r := public.tz_settle(p_room);
  me := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or me.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_type not in ('reveal', 'remove', 'word') then return json_build_object('ok', false, 'reason', 'bad_type'); end if;
  if r.status <> 'playing' or clock_timestamp() < r.started_at or me.player_status <> 'active' or me.left_game then
    return json_build_object('ok', false, 'reason', 'not_playing', 'state', public.tz_view(r, me));
  end if;
  if p_type = any (me.hints_used) then return json_build_object('ok', false, 'reason', 'already_used', 'state', public.tz_view(r, me)); end if;

  if p_type = 'reveal' then
    select i into pos from generate_series(1, 5) i
     where not exists (select 1 from public.tz_guesses g where g.player_id = me.id and substr(g.word, i, 1) = substr(r.secret_word, i, 1))
     order by random() limit 1;
    if pos is null then return json_build_object('ok', false, 'reason', 'nothing_to_reveal'); end if;
    data := jsonb_build_object('pos', pos - 1, 'letter', substr(r.secret_word, pos, 1));
  elsif p_type = 'remove' then
    select coalesce(array_agg(l), '{}') into letters from (
      select chr(96 + i) as l from generate_series(1, 26) i
       where position(chr(96 + i) in r.secret_word) = 0
         and not exists (select 1 from public.tz_guesses g where g.player_id = me.id and position(chr(96 + i) in g.word) > 0)
       order by random() limit 5) s;
    if cardinality(letters) = 0 then return json_build_object('ok', false, 'reason', 'nothing_to_remove'); end if;
    data := jsonb_build_object('letters', to_jsonb(letters));
  else
    select c into clue from (select jsonb_array_elements(w.clue) as c from public.battle_words w where w.word = r.secret_word) s order by random() limit 1;
    if clue is null then return json_build_object('ok', false, 'reason', 'no_clue'); end if;
    data := jsonb_build_object('type', clue->>0, 'text', clue->>1);
  end if;

  update public.tz_players
     set hints_used = array_append(hints_used, p_type), hint_data = hint_data || jsonb_build_object(p_type, data), last_seen = clock_timestamp()
   where id = me.id;
  select * into me from public.tz_players where id = me.id;
  return json_build_object('ok', true, 'type', p_type, 'data', data, 'state', public.tz_view(r, me));
end $$;

-- Leave. In the lobby this is the same as before (host cancels, guest leaves). During a battle leaving is a forfeit:
-- you are out, your score stays on the board, and the battle goes on for the others.
create or replace function public.tz_leave(p_room uuid, p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; pl public.tz_players%rowtype;
begin
  r := public.tz_settle(p_room);
  pl := public.tz_mine(p_room, p_pid, p_secret);
  if r.id is null or pl.id is null then return json_build_object('ok', false, 'reason', 'forbidden'); end if;

  if r.status = 'waiting' then
    if pl.seat = 1 then
      update public.tz_rooms set status = 'cancelled' where id = r.id;
      perform public.tz_bump(r.id);
    else
      delete from public.tz_players where id = pl.id;
      update public.tz_players set is_ready = false where room_id = r.id;
      perform public.tz_bump(r.id);
    end if;
  elsif r.status = 'playing' then
    update public.tz_players
       set left_game = true, player_status = case when player_status = 'active' then 'failed' else player_status end
     where id = pl.id;
    perform public.tz_after_change(r.id);
  else
    return json_build_object('ok', false, 'reason', 'not_in_lobby');
  end if;
  return json_build_object('ok', true, 'left', true);
end $$;

revoke all on function public.tz_finish(uuid, text) from public, anon, authenticated;
revoke all on function public.tz_after_change(uuid) from public, anon, authenticated;
revoke all on function public.tz_guess(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.tz_hint(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.tz_guess(uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.tz_hint(uuid, text, uuid, text) to anon, authenticated;
