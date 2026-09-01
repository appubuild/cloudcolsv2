-- Local-folder backup: device-initiated backup jobs.
-- A job groups many items (files) the user selected on their device and mirrors
-- their folder layout to cloud storage. Progress/status is reported by the app
-- back to these tables so it is visible across web + mobile.

create table if not exists public.backup_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  destination_folder text,
  total_bytes bigint not null default 0,
  uploaded_bytes bigint not null default 0,
  total_items integer not null default 0,
  uploaded_items integer not null default 0,
  wifi_only boolean not null default true,
  status text not null default 'queued'
    check (status in ('queued','uploading','waitingWifi','paused','completed','failed','cancelled')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.backup_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.backup_jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  relative_path text,
  local_identifier text,
  mime_type text,
  size_bytes bigint not null default 0,
  status text not null default 'queued'
    check (status in ('queued','uploading','waitingWifi','paused','completed','failed','cancelled')),
  progress real not null default 0,
  error_message text,
  file_id uuid references public.files(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists backup_jobs_owner_idx on public.backup_jobs(owner_id, created_at desc);
create index if not exists backup_job_items_job_idx on public.backup_job_items(job_id);

alter table public.backup_jobs enable row level security;
alter table public.backup_job_items enable row level security;

create policy "backup_jobs_all" on public.backup_jobs for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "backup_job_items_all" on public.backup_job_items for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Create a backup job and seed its items in one transaction.
create or replace function public.create_backup_job(
  p_owner_id uuid,
  p_name text,
  p_destination_folder text,
  p_total_bytes bigint,
  p_total_items integer,
  p_wifi_only boolean,
  p_items jsonb
) returns setof public.backup_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.backup_jobs;
  v_item jsonb;
begin
  -- The function runs as its definer, so RLS does not constrain it, and the owner
  -- arrives as a parameter. Without this check any signed-in caller could invoke it
  -- over PostgREST with someone else's id and create jobs in their account.
  --
  -- Only a caller acting as a user is constrained: the service role has no
  -- auth.uid(), so the server-side API path is unaffected.
  if auth.uid() is not null and auth.uid() <> p_owner_id then
    raise exception 'a backup job can only be created for yourself'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.backup_jobs
    (owner_id, name, destination_folder, total_bytes, total_items, wifi_only, status)
  values
    (p_owner_id, p_name, p_destination_folder, p_total_bytes, p_total_items, p_wifi_only, 'queued')
  returning * into v_job;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.backup_job_items
      (job_id, owner_id, filename, relative_path, local_identifier, mime_type, size_bytes)
    values
      (v_job.id, p_owner_id,
       v_item->>'filename',
       coalesce(v_item->>'relative_path', v_item->>'filename'),
       v_item->>'local_identifier',
       v_item->>'mime_type',
       coalesce((v_item->>'size_bytes')::bigint, 0));
  end loop;

  return next v_job;
end;
$$;
