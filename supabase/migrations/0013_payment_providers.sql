-- Payment providers, their settings, and what a payment is attached to.
--
-- Settings live in the database rather than in Worker variables so an admin can
-- rotate a Stripe key without a deploy. That means the database holds a secret,
-- which is only acceptable if it is unreadable there: the secret half of each
-- provider's configuration is stored encrypted, and the key that decrypts it is a
-- Worker secret that never touches Postgres. Someone with a database dump gets
-- ciphertext.
--
-- The table is deny-all to every browser-facing role. Only the service role — the
-- API's own credential — reads it, and the API only ever returns the publishable
-- half to a client.

create table if not exists public.payment_settings (
  provider text primary key check (provider in ('stripe', 'crypto')),

  is_enabled boolean not null default false,
  test_mode boolean not null default true,

  -- Safe to show an admin and to send to a browser: publishable keys are designed
  -- to ship in page source, and price ids identify a product, not an account.
  public_config jsonb not null default '{}'::jsonb,

  -- AES-256-GCM ciphertext of the secret half: the secret key, the webhook
  -- signing secret. Never returned by any endpoint, in any form.
  secret_ciphertext text,
  secret_iv text,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.payment_settings enable row level security;
-- No policy at all: deny-all. The service role bypasses RLS; nothing else may read
-- a row that contains a payment credential, even in encrypted form.

insert into public.payment_settings (provider, is_enabled, test_mode)
values ('stripe', false, true), ('crypto', false, true)
on conflict (provider) do nothing;

-- ---------------------------------------------------------------------------
-- What Stripe told us, so a plan is granted once and only against a real charge.
-- ---------------------------------------------------------------------------

alter table public.subscriptions add column if not exists provider_subscription_id text;
alter table public.subscriptions add column if not exists provider_customer_id text;
alter table public.subscriptions add column if not exists current_period_end timestamptz;

alter table public.payments add column if not exists provider_payment_id text;
alter table public.payments add column if not exists provider_session_id text;

-- One subscription per provider subscription. Stripe redelivers webhooks — it is
-- documented to, and it does — so the same event must not create a second row.
create unique index if not exists subscriptions_provider_id_idx
  on public.subscriptions (provider_subscription_id)
  where provider_subscription_id is not null;

create unique index if not exists payments_provider_id_idx
  on public.payments (provider_payment_id)
  where provider_payment_id is not null;

-- ---------------------------------------------------------------------------
-- Every webhook event we have already handled.
-- ---------------------------------------------------------------------------
--
-- Idempotency by record rather than by hope. Stripe delivers at least once, and a
-- retried "payment succeeded" that is processed twice grants the plan twice and
-- bills the books twice. Inserting the event id first, and treating a unique
-- violation as "already done", makes the second delivery a no-op.

create table if not exists public.payment_events (
  id text primary key,             -- the provider's event id, e.g. evt_...
  provider text not null,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create index if not exists payment_events_received_idx
  on public.payment_events (received_at desc);

alter table public.payment_events enable row level security;
-- Deny-all, as above: service role only.
