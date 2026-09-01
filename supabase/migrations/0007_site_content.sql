-- Landing-page content (CMS).
-- A single-row-per-key design: content is stored as a JSONB document keyed by
-- a stable content key (e.g. 'landing'), with versioning timestamps. Public
-- reads are permitted selectively; writes require the admin token (handled by
-- the API layer, not RLS).

create table if not exists public.site_content (
  key text primary key,
  content jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;

-- Public read is allowed via the API; the API uses a `requireUser`/public route
-- for GET and `requireAdmin` for writes, so RLS here can stay deny-by-default.
create policy "site_content_none" on public.site_content for all
  using (false) with check (false);
