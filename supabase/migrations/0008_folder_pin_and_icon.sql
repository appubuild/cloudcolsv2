-- Pinned folders and custom folder icons.
--
-- Both are per-folder presentation state, so they live on the folder rather than
-- in a side table: there is exactly one value per folder, it is always wanted
-- when the folder is listed, and a join to fetch it would be pure cost.

alter table public.folders add column if not exists is_pinned boolean not null default false;

-- A key, not a class name or an SVG. The client owns what each key looks like, so
-- the icon set can change without a migration, and a key the client no longer
-- recognises falls back to the default folder rather than rendering nothing.
alter table public.folders add column if not exists icon text;

alter table public.folders drop constraint if exists folders_icon_key_shape;
alter table public.folders
  add constraint folders_icon_key_shape
  check (icon is null or icon ~ '^[a-z][a-z0-9_-]{0,31}$');

-- Pinned folders sort first, so the index that serves the listing has to agree
-- with that order or every page does a sort.
create index if not exists folders_owner_pinned_idx
  on public.folders (owner_id, is_pinned desc, name)
  where trashed_at is null;

comment on column public.folders.is_pinned is
  'Pinned folders sort above everything else in their parent.';
comment on column public.folders.icon is
  'Icon key chosen by the owner, e.g. "work". Null means the default folder icon.';
