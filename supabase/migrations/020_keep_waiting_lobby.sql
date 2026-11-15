-- Wordle Battle: a waiting lobby is no longer cancelled just because the HOST was away. Run once in the Supabase SQL Editor. Safe to run again.
--
-- THE CAUSE (server side): both settle functions expired a waiting room when the host's last check-in was more than 75 seconds old.
-- The host's page cannot check in while WhatsApp (or any other app) is in front of it, and the check was also run the moment the host came back,
-- BEFORE their own check-in was recorded, so returning from WhatsApp could end the host's own room ("room expired / cancelled").
--
-- THE FIX: a waiting or lobby room now ends in exactly two ways: the host chooses Cancel Room (bt_leave / tz_leave, unchanged) or the room
-- reaches its normal expiry time (expires_at, unchanged: 10 minutes after it was created). The invitation token and room code stay valid in between.
-- Everything else in these two functions is exactly as before (a guest who has been silent for 75 s still frees their seat, forfeits during a
-- battle, timeouts, rematch expiry, ...). Nothing else is changed.

create or replace function public.bt_settle(p_room uuid) returns public.battle_rooms
language plpgsql security definer set search_path = '' as $$
declare r public.battle_rooms%rowtype; a public.battle_players%rowtype; b public.battle_players%rowtype; changed boolean := false;
begin
  select * into r from public.battle_rooms where id = p_room for update;
  if not found then return r; end if;

  update public.battle_rematches set status = 'expired' where previous_room_id = r.id and status = 'pending' and expires_at < clock_timestamp();
  if found then changed := true; end if;

  if r.status in ('waiting', 'lobby') then
    if r.expires_at < clock_timestamp() then                                  -- a room only ends by its own expiry time or when the host cancels it
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

create or replace function public.tz_settle(p_room uuid) returns public.tz_rooms
language plpgsql security definer set search_path = '' as $$
declare r public.tz_rooms%rowtype; host public.tz_players%rowtype; n int;
begin
  select * into r from public.tz_rooms where id = p_room for update;
  if not found then return r; end if;

  if r.status = 'waiting' then
    select * into host from public.tz_players where room_id = r.id and seat = 1;
    if r.expires_at < clock_timestamp() or host.id is null then               -- a room only ends by its own expiry time or when the host cancels it
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

  elsif r.status = 'finished' then
    if r.rematch_status = 'open' and r.rematch_new_room is null and r.rematch_expires <= clock_timestamp() then
      update public.tz_rooms set rematch_status = 'expired' where id = r.id;
      perform public.tz_bump(r.id);
    end if;
  end if;

  select * into r from public.tz_rooms where id = p_room;
  return r;
end $$;