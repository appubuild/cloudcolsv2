-- Two-factor authentication.
--
-- Supabase Auth holds the TOTP factors themselves; this records the two things the
-- app decides on:
--
--   user_storage.mfa_enabled   whether this account requires a second factor. Read by
--                              requireUser on every request, alongside the suspension
--                              check it already does, so enforcement costs no extra
--                              query. Set only when a factor has been verified, cleared
--                              only when the factors are removed.
--
--   mfa_recovery_codes         single-use codes for a lost phone, stored as SHA-256
--                              hashes. Without them a lost device is a lost account.
--
-- Server-only, like every table the browser has no business writing (migration 0023).

alter table public.user_storage
  add column if not exists mfa_enabled boolean not null default false;

create table if not exists public.mfa_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists mfa_recovery_codes_user_idx on public.mfa_recovery_codes (user_id);

alter table public.mfa_recovery_codes enable row level security;
revoke all on public.mfa_recovery_codes from anon, authenticated;
