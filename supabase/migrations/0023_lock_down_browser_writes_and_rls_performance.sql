-- Browser roles never write tables; RLS policies stop re-evaluating auth per row.
--
-- 1. Direct writes.
--
-- Supabase's defaults grant anon and authenticated full INSERT/UPDATE/DELETE on every
-- table, leaving RLS as the only barrier. This app never writes through those roles:
-- every write goes through an API route on the service-role client, and the browser's
-- Supabase client is used for authentication only. But several policies were written
-- as "the owner may do anything to their own row", and with the grants in place that
-- was reachable straight through PostgREST, bypassing every check the API makes:
--
--   profiles       a user could set is_admin, plan_id, status on themselves
--   share_invitations  a user could write an "accepted" invitation to someone
--                  else's file, and files_shared_read would then show them its row
--   subscriptions, payments   forge their own billing history
--   api_keys       pick their own API plan
--   webhooks       register targets the API's URL validation would refuse
--
-- Revoking the writes closes all of these at once, and closes whatever the next
-- permissive policy would have opened. Reads are left as they are: RLS already scopes
-- them to the caller's own rows, and nothing here depends on removing them.

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- And for tables created later, so a new table is not writable from the browser by
-- default and quietly reopens this.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables from anon, authenticated;

-- 2. auth.uid() evaluated once per query, not once per row.
--
-- A bare auth.uid() in a policy is re-run for every row the query touches;
-- (select auth.uid()) is an initplan evaluated once. Same result, and the difference
-- grows with the table. Rewritten in place with ALTER POLICY, so each policy keeps its
-- name, command and roles. Clauses already in the (select ...) form are left alone,
-- and the prototype legacy_* tables are skipped.

do $$
declare
  r record;
  q text;
  c text;
  needs_q boolean;
  needs_c boolean;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename not like 'legacy\_%'
  loop
    needs_q := r.qual is not null
      and position('auth.uid()' in r.qual) > 0
      and position('SELECT auth.uid()' in r.qual) = 0;
    needs_c := r.with_check is not null
      and position('auth.uid()' in r.with_check) > 0
      and position('SELECT auth.uid()' in r.with_check) = 0;

    continue when not needs_q and not needs_c;

    q := case when needs_q then replace(r.qual, 'auth.uid()', '(select auth.uid())') end;
    c := case when needs_c then replace(r.with_check, 'auth.uid()', '(select auth.uid())') end;

    execute format(
      'alter policy %I on public.%I %s %s',
      r.policyname,
      r.tablename,
      case when needs_q then 'using (' || q || ')' else '' end,
      case when needs_c then 'with check (' || c || ')' else '' end
    );
  end loop;
end $$;

-- 3. Indexes behind foreign keys.
--
-- Without one, deleting a referenced row scans the referencing table, and every join
-- on the key does too. Application tables only; the legacy_* tables are unused.

create index if not exists admins_user_id_idx              on public.admins (user_id);
create index if not exists api_keys_api_plan_id_idx        on public.api_keys (api_plan_id);
create index if not exists api_usage_daily_api_key_id_idx  on public.api_usage_daily (api_key_id);
create index if not exists app_secrets_updated_by_idx      on public.app_secrets (updated_by);
create index if not exists backup_job_items_file_id_idx    on public.backup_job_items (file_id);
create index if not exists backup_job_items_owner_id_idx   on public.backup_job_items (owner_id);
create index if not exists file_activity_file_id_idx       on public.file_activity (file_id);
create index if not exists file_activity_folder_id_idx     on public.file_activity (folder_id);
create index if not exists payment_settings_updated_by_idx on public.payment_settings (updated_by);
create index if not exists payments_subscription_id_idx    on public.payments (subscription_id);
create index if not exists share_links_folder_id_idx       on public.share_links (folder_id);
create index if not exists shares_folder_id_idx            on public.shares (folder_id);
create index if not exists site_content_updated_by_idx     on public.site_content (updated_by);
create index if not exists system_settings_updated_by_idx  on public.system_settings (updated_by);

-- 4. Two identical indexes on files.original_filename; every write maintained both.
drop index if exists public.files_name_ilike_idx;
