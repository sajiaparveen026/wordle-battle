-- Remembers (per account, across devices) that the player finished or skipped the How to Play tutorial.
-- Purely cosmetic, so players may set it on their own row. Safe to run more than once.
alter table public.profiles add column if not exists tutorial_completed_at timestamptz;
grant update (tutorial_completed_at) on public.profiles to authenticated;
