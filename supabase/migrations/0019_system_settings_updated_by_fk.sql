-- Makes a fresh database match the live one.
--
-- 0018 adopted the existing system_settings table with `create table if not exists`,
-- which on the live database was a no-op — so the table there kept a constraint the
-- migration file did not describe:
--
--     updated_by uuid references auth.users(id) on delete set null
--
-- A database rebuilt from these migrations would not have had it, and the two would
-- have drifted. Worse, the constraint is the kind that only shows up at write time:
-- the first settings write failed with a foreign key violation because the code was
-- passing the `admins` row id, and admins.id and auth.users.id are different uuids
-- that nothing but the database distinguishes.
--
-- The code now passes the auth user id. This adds the constraint where it is missing
-- so both sides agree about what that column means.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'system_settings_updated_by_fkey'
      and conrelid = 'public.system_settings'::regclass
  ) then
    alter table public.system_settings
      add constraint system_settings_updated_by_fkey
      foreign key (updated_by) references auth.users(id) on delete set null;
  end if;
end $$;
