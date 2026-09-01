-- CloudCols metadata schema (Supabase Postgres).
-- Large binaries live in Backblaze B2; these tables hold metadata + app state only.

-- Enable RLS helpers
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- User storage profile (quota, plan). One row per auth user, enforced by RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.user_storage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null default 'plan_free',
  storage_quota_bytes bigint not null default 5368709120, -- 5 GB
  storage_used_bytes bigint not null default 0,
  developer_enabled boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Folders
-- ---------------------------------------------------------------------------
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.folders(id) on delete set null,
  name text not null,
  path text not null default '',
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folders_owner_idx on public.folders(owner_id);
create index if not exists folders_parent_idx on public.folders(parent_id);

-- ---------------------------------------------------------------------------
-- Files (metadata; bytes in B2 keyed by object_key)
-- ---------------------------------------------------------------------------
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  object_key text not null unique,
  original_filename text not null,
  mime_type text not null,
  category text not null,
  size_bytes bigint not null,
  thumbnail_url text,
  checksum text,
  status text not null default 'pending', -- pending | ready | quarantined | processing
  is_favorite boolean not null default false,
  trashed_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists files_owner_idx on public.files(owner_id);
create index if not exists files_folder_idx on public.files(folder_id);
create index if not exists files_category_idx on public.files(category);
-- gin_trgm_ops lives in the extensions schema on Supabase and does not resolve
-- unqualified from a migration's search_path.
create index if not exists files_name_trgm on public.files using gin (original_filename extensions.gin_trgm_ops);
create index if not exists files_created_idx on public.files(created_at desc);

-- ---------------------------------------------------------------------------
-- Share links
-- ---------------------------------------------------------------------------
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,
  token text not null unique,
  permission text not null default 'view', -- view | download
  expires_at timestamptz,
  is_revoked boolean not null default false,
  access_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists share_links_owner_idx on public.share_links(owner_id);
create index if not exists share_links_token_idx on public.share_links(token);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text not null default '',
  is_read boolean not null default false,
  link text,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;
create policy "notifications_select" on public.notifications for select using (auth.uid() = user_id);
create policy "notifications_update" on public.notifications for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Users can only ever read/write their own metadata rows.
-- ---------------------------------------------------------------------------
alter table public.user_storage enable row level security;
alter table public.folders enable row level security;
alter table public.files enable row level security;
alter table public.share_links enable row level security;

create policy "user_storage_select" on public.user_storage for select using (auth.uid() = user_id);
create policy "user_storage_update" on public.user_storage for update using (auth.uid() = user_id);

create policy "folders_all" on public.folders for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "files_all" on public.files for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "share_links_all" on public.share_links for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Quota enforcement trigger (server-side; never trust the client).
-- Files are only counted once their status becomes 'ready'.
-- ---------------------------------------------------------------------------
create or replace function public.sync_quota()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  uid uuid;
begin
  uid := coalesce(new.owner_id, old.owner_id);
  update public.user_storage us
     set storage_used_bytes = (
       select coalesce(sum(f.size_bytes), 0)
         from public.files f
        where f.owner_id = us.user_id
          and f.status = 'ready'
          and f.trashed_at is null
     )
   where us.user_id = uid;
  return coalesce(new, old);
end; $$;

drop trigger if exists files_quota_trigger on public.files;
create trigger files_quota_trigger
  after insert or update or delete on public.files
  for each row execute function public.sync_quota();

-- Seed the demo storage plan profile if absent (created lazily in code on signup too).
insert into public.user_storage (user_id, plan_id, storage_quota_bytes, storage_used_bytes, status)
select id, 'plan_free', 5368709120, 0, 'active'
from auth.users
on conflict (user_id) do nothing;
