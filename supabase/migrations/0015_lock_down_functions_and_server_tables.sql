-- Close the two ways the database could be reached without going through the API.
--
-- 1. SECURITY DEFINER functions that PostgREST exposed to anon/authenticated.
--    A SECURITY DEFINER function runs as its owner, so RLS does not apply inside
--    it. Four of ours were executable by `anon` over /rest/v1/rpc, which means a
--    stranger with the publishable key could call them.
--
--    The worst was create_backup_job(p_owner_id uuid, ...): the owner is an
--    argument, so it never asked who was calling. Anyone could create backup jobs
--    against any account. record_activity has the same shape. sync_quota and
--    link_pending_invitations are trigger functions that were never meant to be
--    called directly at all.
--
--    Every one of these is only ever invoked by our server (service_role) or by a
--    trigger, so revoking the client roles changes no application behaviour. The
--    fix is the revoke rather than a rewrite: adding auth.uid() checks inside them
--    would break the server, which legitimately acts on a user's behalf and has no
--    auth.uid() of its own.
--
-- 2. Tables with RLS enabled and no policy. That already denies everything, but it
--    reads as an oversight. An explicit deny says it was decided: these tables are
--    server-only and no browser session may touch them, whatever key it holds.

-- ---------------------------------------------------------------------------
-- 1. Functions
-- ---------------------------------------------------------------------------

revoke all on function public.create_backup_job(uuid, text, text, bigint, integer, boolean, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_activity(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.sync_quota()
  from public, anon, authenticated;
revoke all on function public.link_pending_invitations()
  from public, anon, authenticated;

-- Trigger-only helpers. SECURITY INVOKER, so less dangerous, but nothing outside a
-- trigger has any business calling them.
revoke all on function public.share_grants_guard_recipient_update()
  from public, anon, authenticated;
revoke all on function public.share_grants_touch_updated_at()
  from public, anon, authenticated;
revoke all on function public.touch_share_invitation()
  from public, anon, authenticated;

-- The API connects as service_role; keep it able to call what it calls.
grant execute on function public.create_backup_job(uuid, text, text, bigint, integer, boolean, jsonb) to service_role;
grant execute on function public.record_activity(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Server-only tables: deny every client role explicitly
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'api_plans',
    'api_request_logs',
    'app_secret_definitions',
    'app_secrets',
    'audit_log',
    'audit_logs',
    'payment_events',
    'payment_settings',
    'system_settings',
    'webhook_deliveries'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_server_only'
    ) then
      execute format(
        'create policy %I on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
        t || '_server_only', t
      );
    end if;
  end loop;
end $$;
