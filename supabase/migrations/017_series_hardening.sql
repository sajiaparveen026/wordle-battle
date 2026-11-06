-- Wordle Battle: Series Mode, STAGE 4 (cleanup + getting back to the final screen after a refresh). Run once AFTER 016. Safe to run again.
--  * Old series are removed automatically (the same way old rooms are: housekeeping runs whenever someone creates a series):
--      finished series after 7 days (only when every reward in it has been collected), unfinished lobbies after 1 day, stuck series after 2 days.
--      Their rounds, players and reward rows go with them (ON DELETE CASCADE).
--  * series_recent: after a refresh the app asks "did I just finish a series?" so it can show the final result screen again (and pay anything unpaid).

create or replace function public.series_cleanup_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.series s
   where (s.status = 'finished' and s.completed_at < now() - interval '7 days'
          and not exists (select 1 from public.series_rewards r where r.series_id = s.id and not r.claimed))
      or (s.status = 'lobby' and s.created_at < now() - interval '1 day')
      or (s.status = 'cancelled' and s.created_at < now() - interval '1 day')
      or (s.status = 'playing' and s.created_at < now() - interval '2 days');
  return null;
end $$;
revoke all on function public.series_cleanup_trg() from public, anon, authenticated;
drop trigger if exists series_cleanup_after_insert on public.series;
create trigger series_cleanup_after_insert after insert on public.series for each statement execute function public.series_cleanup_trg();

create or replace function public.series_recent(p_pid uuid default null, p_secret text default null) returns json
language plpgsql security definer stable set search_path = '' as $$
declare a record; s public.series%rowtype;
begin
  select * into a from public.bt_actor(p_pid, p_secret);
  if not a.ok then return json_build_object('ok', false, 'reason', 'bad_id'); end if;
  select se.* into s from public.series se join public.series_players sp on sp.series_id = se.id
   where se.status = 'finished' and se.completed_at > now() - interval '20 minutes'
     and ((a.uid is not null and sp.user_id = a.uid) or (a.uid is null and sp.guest_pid = p_pid and sp.key_hash = a.h))
   order by se.completed_at desc limit 1;
  if s.id is null then return json_build_object('ok', true, 'series_id', null); end if;
  return json_build_object('ok', true, 'series_id', s.id, 'mode', s.mode);
end $$;
revoke all on function public.series_recent(uuid, text) from public, anon, authenticated;
grant execute on function public.series_recent(uuid, text) to anon, authenticated;

-- Your room-creation limit (5 rooms a minute per host) counts every room the host is recorded on. The rooms for rounds 2, 3, ... are made by the
-- system, not by the host tapping Create, so they are back-dated and never count toward that limit (otherwise a quick series could block Play Again).
create or replace function public.series_make_next(p_series uuid, p_old uuid, p_next timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.series%rowtype; w text; nid uuid; code text; tries int := 0; i int; n int;
        cutoff timestamptz := clock_timestamp() - interval '75 seconds';
        alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  select * into s from public.series where id = p_series;
  -- a word that has not been used in this series
  select word into w from public.battle_words
   where is_answer and word not in (select secret_word from public.series_rounds where series_id = p_series and secret_word is not null)
   order by random() limit 1;
  if w is null then return null; end if;

  if s.mode = 'friend' then
    select count(*) into n from public.battle_players where room_id = p_old and connection_status <> 'left' and last_seen > cutoff;
    if n < 2 then return null; end if;
    loop
      code := ''; for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
      begin
        insert into public.battle_rooms (room_code, host_user_id, host_guest_pid, difficulty, duration_seconds, status, secret_word,
                                         expires_at, started_at, ends_at, series_id, series_round, prev_room_id, created_at)
        select code, o.host_user_id, o.host_guest_pid, o.difficulty, o.duration_seconds, 'playing', w,
               p_next + make_interval(secs => o.duration_seconds + 3600), p_next, p_next + make_interval(secs => o.duration_seconds),
               o.series_id, o.series_round + 1, o.id, now() - interval '2 hours'
          from public.battle_rooms o where o.id = p_old
        returning id into nid;
        exit;
      exception when unique_violation then tries := tries + 1; if tries > 20 then return null; end if;
      end;
    end loop;
    insert into public.battle_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar, is_ready, reward_claimed)
    select nid, seat, user_id, guest_pid, key_hash, username, avatar, true, true
      from public.battle_players where room_id = p_old and connection_status <> 'left' and last_seen > cutoff;
  else
    select count(*) into n from public.tz_players where room_id = p_old and not left_game and last_seen > cutoff;
    if n < 2 then return null; end if;
    loop
      code := ''; for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1); end loop;
      begin
        insert into public.tz_rooms (room_code, host_user_id, host_guest_pid, max_players, difficulty, duration_seconds, status, secret_word,
                                     expires_at, started_at, ends_at, series_id, series_round, created_at)
        select code, o.host_user_id, o.host_guest_pid, o.max_players, o.difficulty, o.duration_seconds, 'playing', w,
               p_next + make_interval(secs => o.duration_seconds + 3600), p_next, p_next + make_interval(secs => o.duration_seconds),
               o.series_id, o.series_round + 1, now() - interval '2 hours'
          from public.tz_rooms o where o.id = p_old
        returning id into nid;
        exit;
      exception when unique_violation then tries := tries + 1; if tries > 20 then return null; end if;
      end;
    end loop;
    insert into public.tz_players (room_id, seat, user_id, guest_pid, key_hash, username, avatar, is_ready, reward_claimed)
    select nid, seat, user_id, guest_pid, key_hash, username, avatar, true, true
      from public.tz_players where room_id = p_old and not left_game and last_seen > cutoff;
  end if;
  return nid;
end $$;
revoke all on function public.series_make_next(uuid, uuid, timestamptz) from public, anon, authenticated;