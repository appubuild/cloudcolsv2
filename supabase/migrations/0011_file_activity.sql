-- What the user did with a file, so "Recent" can say "downloaded" rather than
-- only "touched at some point".
--
-- files.last_accessed_at already records that something happened; it cannot say
-- what, and it cannot show the same file twice for two different reasons. One row
-- per (user, file, action) keeps that distinction without the table growing on
-- every click: repeating an action moves its timestamp instead of adding a row,
-- which also stops a file being opened twice in a minute from filling the list
-- with itself.

create table if not exists public.file_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,
  action text not null check (action in ('opened', 'previewed', 'downloaded', 'uploaded', 'modified', 'shared')),
  occurred_at timestamptz not null default now(),

  constraint file_activity_one_target check (
    (file_id is not null and folder_id is null) or (file_id is null and folder_id is not null)
  )
);

create unique index if not exists file_activity_unique_file
  on public.file_activity (user_id, file_id, action)
  where file_id is not null;

create unique index if not exists file_activity_unique_folder
  on public.file_activity (user_id, folder_id, action)
  where folder_id is not null;

-- The dashboard asks for one user's most recent handful; this is the whole query.
create index if not exists file_activity_recent_idx
  on public.file_activity (user_id, occurred_at desc);

alter table public.file_activity enable row level security;

create policy "file_activity_own" on public.file_activity
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Upsert helper so callers do not each reimplement "move the timestamp if it
-- exists, otherwise insert".
create or replace function public.record_activity(
  p_user_id uuid,
  p_file_id uuid,
  p_folder_id uuid,
  p_action text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Only the caller's own activity. The service role has no auth.uid() and is
  -- trusted; a signed-in caller acting as someone else is not.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'activity can only be recorded for yourself'
      using errcode = 'insufficient_privilege';
  end if;

  if p_file_id is not null then
    insert into public.file_activity (user_id, file_id, action)
    values (p_user_id, p_file_id, p_action)
    on conflict (user_id, file_id, action) where file_id is not null
    do update set occurred_at = now();
  elsif p_folder_id is not null then
    insert into public.file_activity (user_id, folder_id, action)
    values (p_user_id, p_folder_id, p_action)
    on conflict (user_id, folder_id, action) where folder_id is not null
    do update set occurred_at = now();
  end if;
end;
$$;
