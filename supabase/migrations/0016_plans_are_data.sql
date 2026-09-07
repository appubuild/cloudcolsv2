-- One place that says what a plan is.
--
-- Until now there were five, and they disagreed. `/api/plans` described the plans
-- to the pricing page, `/api/subscriptions/checkout` decided what to charge,
-- `lib/api/quota.ts` decided how much could be uploaded, `lib/payments/types.ts`
-- decided what a paid webhook granted, and `lib/api/profiles.ts` decided what a new
-- account got. Changing a price meant finding all five, and the admin panel's Plans
-- screen could not change any of them — it edited a browser-local mock and showed a
-- success toast.
--
-- There was already a `plans` table, from the prototype. It is not this: different
-- codes (free / pro_100), different quotas (20 GB free, against the 5 GB every
-- account actually has), and a uuid key where the application uses the plan id as
-- text. Pointing the code at it would have silently changed every account's
-- entitlement. It is moved aside with the other prototype tables instead.
--
-- The seed below is the values the application uses today, exactly. This migration
-- is meant to change nothing at all — it only moves the numbers to where an admin
-- can reach them.

alter table if exists public.plans rename to legacy_plans;

create table public.plans (
  id                  text primary key,
  name                text        not null,
  tagline             text        not null default '',
  storage_quota_bytes bigint      not null check (storage_quota_bytes > 0),
  max_file_size_bytes bigint      not null check (max_file_size_bytes > 0),
  price_cents         integer     not null default 0 check (price_cents >= 0),
  currency            text        not null default 'USD',
  -- Null for a plan nobody is billed for. A price with no interval, or an interval
  -- with no price, is a plan that cannot be charged correctly.
  billing_interval    text        null check (billing_interval in ('monthly', 'yearly')),
  -- An array of strings, shown on the pricing page.
  features            jsonb       not null default '[]'::jsonb,
  shows_ads           boolean     not null default false,
  api_included        boolean     not null default false,
  is_active           boolean     not null default true,
  -- What a new account gets, and what an account falls back to when a subscription
  -- ends. Exactly one row may claim it.
  is_default          boolean     not null default false,
  sort_order          integer     not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint plans_price_needs_interval
    check ((price_cents = 0 and billing_interval is null)
        or (price_cents > 0 and billing_interval is not null))
);

create unique index plans_single_default on public.plans (is_default) where is_default;

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- Server-only, like every other configuration table. The pricing page reads it
-- through /api/plans, which runs on the server; no browser session touches it.
alter table public.plans enable row level security;
create policy plans_server_only on public.plans
  as restrictive for all to anon, authenticated
  using (false) with check (false);

insert into public.plans
  (id, name, tagline, storage_quota_bytes, max_file_size_bytes, price_cents, billing_interval,
   features, shows_ads, api_included, is_active, is_default, sort_order)
values
  ('plan_free', 'Free', 'For getting started',
   5368709120, 1073741824, 0, null,
   '["5 GB storage","Basic file manager","Ads shown","Sharing links"]'::jsonb,
   true, false, true, true, 0),

  ('plan_plus', 'Plus', 'For everyday use',
   107374182400, 2147483648, 499, 'monthly',
   '["100 GB storage","No ads","2 GB max file size","Advanced sharing"]'::jsonb,
   false, false, true, false, 1),

  ('plan_pro', 'Pro', 'For creators & pros',
   214748364800, 3221225472, 899, 'monthly',
   '["200 GB storage","No ads","3 GB max file size","Priority support"]'::jsonb,
   false, true, true, false, 2),

  ('plan_business', 'Business', 'For teams & power users',
   1099511627776, 5368709120, 1999, 'monthly',
   '["1 TB storage","No ads","5 GB max file size","API access"]'::jsonb,
   false, true, true, false, 3);
