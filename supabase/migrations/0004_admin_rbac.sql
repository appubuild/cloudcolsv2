-- CloudCols — admin sessions + RBAC.
-- Run after 0003. Adds a separate admin identity so staff auth is isolated from
-- end-user auth (per the brief: separate admin auth/session).

create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null default '',
  role text not null default 'support', -- super_admin | support | operator
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Super admin bootstrap. Admin passwords are managed via the Admin login flow;
-- the seed admin identity is keyed off the platform owner's email.
insert into public.admins (email, name, role, is_active)
values ('super@cloudcols.com', 'Super Admin', 'super_admin', true)
on conflict (email) do nothing;

create index if not exists admins_email_idx on public.admins(email);

alter table public.admins enable row level security;
-- Admins are read/written via the service role only; no public RLS policy needed
-- beyond owner identity, since ordinary auth.users never access this table.
create policy "admins_select_own" on public.admins for select using (user_id = auth.uid());

-- Profile display fields (referenced by /api/profile). Safe additive columns.
alter table public.user_storage add column if not exists display_name text;
alter table public.user_storage add column if not exists avatar_url text;
