-- CloudCols — dashboard enhancements: folder favorites + last-accessed tracking.
-- Run after 0004. Powers Recent Access, Recent Folders, and Favorite Folders.

alter table public.folders add column if not exists is_favorite boolean not null default false;
alter table public.folders add column if not exists last_accessed_at timestamptz;

create index if not exists folders_owner_fav_idx on public.folders(owner_id) where is_favorite = true;
create index if not exists folders_owner_recent_idx on public.folders(owner_id, last_accessed_at desc);
create index if not exists files_owner_accessed_idx on public.files(owner_id, last_accessed_at desc);

-- Seed a couple of common starter folders for new users so the dashboard has
-- familiar content. Guarded so it only runs for users that never got them.
insert into public.folders (owner_id, name, path, is_favorite)
select s.user_id, 'Documents', 'Documents', true
from public.user_storage s
where not exists (
  select 1 from public.folders f where f.owner_id = s.user_id and f.name = 'Documents'
);
insert into public.folders (owner_id, name, path, is_favorite)
select s.user_id, 'Images', 'Images', false
from public.user_storage s
where not exists (
  select 1 from public.folders f where f.owner_id = s.user_id and f.name = 'Images'
);
