-- Which inactivity warning an account has already been sent.
--
-- The inactivity job runs daily and decided what to send from days-inactive alone, so
-- an account inside the warning window got the same warning email every day for the
-- whole window, and the final warning every day after that. Recording the stage lets
-- each warning go out once. Signing in clears it (app/api/auth/login), so an account
-- that goes inactive again later is warned again from the start.

alter table public.user_storage
  add column if not exists inactivity_stage text
  constraint user_storage_inactivity_stage_check
  check (inactivity_stage in ('warned', 'final_warned'));
