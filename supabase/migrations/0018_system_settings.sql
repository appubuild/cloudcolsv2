-- Brings system_settings into this project's migration chain, and adds the one key
-- the ads screen needs.
--
-- The table already exists in the live database — it came from the prototype schema
-- and, unlike `plans`, it was shaped correctly: a key, a jsonb value, a description,
-- and is_public separating what a browser may read from what only the server may.
-- Rather than build a second settings table beside it, this adopts it.
--
-- Everything here is idempotent, because it has to run against a database where the
-- table and most of the rows already exist, and against an empty one.
--
-- What moved into it: the values that used to be environment variables read through
-- process.env, which on Workers does not see the binding. TRASH_RETENTION_DAYS and
-- the four INACTIVITY_* variables were documented in .env.example and had never had
-- any effect at all — each reader fell back to its own hardcoded default.
--
-- Note the inactivity numbers. The seeded values (a year before the first warning)
-- are kept over the 90 days that were hardcoded in lib/jobs/inactivity.ts. That job
-- ends in deleting an account, and where two sources disagreed the cautious one is
-- the one to keep.

create table if not exists public.system_settings (
  key         text primary key,
  value       jsonb       not null,
  description text,
  is_public   boolean     not null default false,
  updated_at  timestamptz not null default now(),
  -- The admins row id of whoever last changed it. Deliberately not a foreign key to
  -- auth.users: an admin is a row in `admins`, and those are different ids.
  updated_by  uuid
);

alter table public.system_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'system_settings' and policyname = 'system_settings_server_only'
  ) then
    create policy system_settings_server_only on public.system_settings
      as restrictive for all to anon, authenticated
      using (false) with check (false);
  end if;
end $$;

-- Seeds only what is absent, so an admin's existing values are never overwritten.
insert into public.system_settings (key, value, description, is_public) values
  ('ads_enabled', 'true'::jsonb, 'Master switch for ads on ad-supported plans', true),
  ('ads_config', '{"providerId":"","placements":{}}'::jsonb, 'Ad provider id and which placements are enabled', true),
  ('maintenance_mode', 'false'::jsonb, 'When true, non-admin write operations are rejected', true),
  ('registration_enabled', 'true'::jsonb, 'Allow new account registration', true),
  ('max_file_size_bytes', '3221225472'::jsonb, 'Hard ceiling on a single upload, across every plan', true),
  ('trash_retention_days', '30'::jsonb, 'Days a file stays in trash before permanent deletion', true),
  ('trash_counts_toward_quota', 'true'::jsonb, 'Whether trashed files consume storage quota', true),
  ('inactivity_warn_days', '365'::jsonb, 'Days of inactivity before the first warning', false),
  ('inactivity_final_warn_days', '395'::jsonb, 'Days of inactivity before the final warning', false),
  ('inactivity_grace_days', '425'::jsonb, 'Days of inactivity before the account is scheduled for deletion', false),
  ('allowed_upload_mime_deny',
   '["application/x-msdownload","application/x-msdos-program","application/x-sh"]'::jsonb,
   'MIME types rejected at upload, on top of the built-in allow-list', false),
  ('signed_url_ttl_seconds', '900'::jsonb, 'Lifetime of presigned download and preview URLs', false),
  ('upload_url_ttl_seconds', '3600'::jsonb, 'Lifetime of presigned upload URLs', false)
on conflict (key) do nothing;
