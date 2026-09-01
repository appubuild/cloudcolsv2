-- CloudCols — developer API, subscriptions/payments, audit + background jobs tables.
-- Run after 0001_init.sql in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- API plans (separate commercial product from storage plans)
-- ---------------------------------------------------------------------------
create table if not exists public.api_plans (
  id text primary key,
  name text not null,
  requests_per_month integer not null default 10000,
  rate_limit_per_minute integer not null default 60,
  price_cents integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.api_plans (id, name, requests_per_month, rate_limit_per_minute, price_cents, is_active) values
  ('api_free', 'Developer Free', 10000, 60, 0, true),
  ('api_pro', 'Developer', 200000, 300, 2900, true),
  ('api_business', 'Business', 2000000, 1500, 9900, true),
  ('api_enterprise', 'Enterprise', 20000000, 5000, 0, false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- API keys (hashed secret, prefix for display, scopes, revocable/rotatable)
-- ---------------------------------------------------------------------------
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  api_plan_id text not null references public.api_plans(id),
  key_prefix text not null,
  hashed_key text not null,
  label text not null default 'Untitled key',
  scopes text[] not null default array[]::text[],
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists api_keys_user_idx on public.api_keys(user_id);

-- ---------------------------------------------------------------------------
-- API request logs (aggregated usage stats)
-- ---------------------------------------------------------------------------
create table if not exists public.api_request_logs (
  id bigint generated always as identity primary key,
  api_key_id uuid references public.api_keys(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null,
  method text not null,
  status_code integer not null,
  response_time_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists api_logs_key_idx on public.api_request_logs(api_key_id, created_at desc);
create index if not exists api_logs_user_idx on public.api_request_logs(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Webhooks
-- ---------------------------------------------------------------------------
create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  events text[] not null default '{}',
  status text not null default 'active',
  secret text not null,
  last_delivery_status text,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists webhooks_user_idx on public.webhooks(user_id);

-- ---------------------------------------------------------------------------
-- Subscriptions + Payments
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  status text not null default 'active', -- active | cancelled | expired | past_due
  provider text,
  started_at timestamptz not null default now(),
  renews_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists subscriptions_user_idx on public.subscriptions(user_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_cents integer not null,
  currency text not null default 'USD',
  provider text,
  status text not null default 'pending', -- succeeded | failed | refunded | pending
  created_at timestamptz not null default now()
);

create index if not exists payments_user_idx on public.payments(user_id);

-- ---------------------------------------------------------------------------
-- Audit log (all admin + security-relevant actions)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_type text not null default 'system', -- user | admin | system
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs(action);

-- RLS: api_keys, webhooks, subscriptions, payments, notifications scoped to owner.
-- api_request_logs / audit_logs are admin-read (via service role), scoped here for safety.
alter table public.api_keys enable row level security;
alter table public.webhooks enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;

create policy "api_keys_owner" on public.api_keys for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "webhooks_owner" on public.webhooks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "subscriptions_owner" on public.subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "payments_owner" on public.payments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
