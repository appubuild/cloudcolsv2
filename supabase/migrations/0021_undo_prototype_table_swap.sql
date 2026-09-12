-- Undo migration 20260912152831.
--
-- On 2026-09-12 at 15:28 UTC a migration with no name (only a UUID), not from this
-- repository, reversed 20260901173724:
--
--   files   -> files_v2,   legacy_files   -> files
--   folders -> folders_v2, legacy_folders -> folders
--   plans   -> plans_v2,   legacy_plans   -> plans
--
-- The web app reads the application columns (original_filename, status,
-- thumbnail_url), so every file query failed with 42703. /api/plans reported a
-- maximum file size of 0, so every upload would have been refused. handle_new_user
-- looks up legacy_plans by name, so signups failed too.
--
-- Nothing was written to any of these tables between the swap and this migration,
-- so renaming them back loses nothing. Only runs when the database is in exactly
-- that swapped state; otherwise it changes nothing.

do $$
begin
  if to_regclass('public.files_v2') is not null
     and to_regclass('public.folders_v2') is not null
     and to_regclass('public.plans_v2') is not null
     and to_regclass('public.legacy_files') is null
     and to_regclass('public.legacy_folders') is null
     and to_regclass('public.legacy_plans') is null
  then
    alter table public.files   rename to legacy_files;
    alter table public.folders rename to legacy_folders;
    alter table public.plans   rename to legacy_plans;

    alter table public.files_v2   rename to files;
    alter table public.folders_v2 rename to folders;
    alter table public.plans_v2   rename to plans;

    -- The swap granted authenticated DML on the prototype tables; they follow their
    -- tables through the rename. Nothing reads the legacy tables through the API.
    revoke insert, update, delete on public.legacy_files   from authenticated;
    revoke insert, update, delete on public.legacy_folders from authenticated;
  else
    raise notice 'Tables are not in the swapped state; nothing changed.';
  end if;
end $$;
