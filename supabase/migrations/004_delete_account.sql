-- Wordle Battle: let a signed-in player delete THEIR OWN account (Settings > Privacy & Security > Delete Account).
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- Why a function? The app only has the public anon key, which can never delete users. This function runs with the
-- database owner's rights (security definer) but only ever deletes the caller's own row (auth.uid()).
-- profiles, solo_saves and free_coin_claims all reference auth.users(id) ON DELETE CASCADE, so deleting the
-- auth user also removes the player's profile, cloud save and free-coin record.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end
$$;

-- Only signed-in players may call it (never the anonymous/public role).
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
