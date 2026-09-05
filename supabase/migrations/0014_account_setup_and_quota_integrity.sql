-- Account setup details, and closing a hole that made them the smaller half of
-- this migration.
--
-- The hole first, because it matters more.
--
-- 0001 gave authenticated users an UPDATE policy on user_storage:
--
--   create policy "user_storage_update" on public.user_storage
--     for update using (auth.uid() = user_id);
--
-- That reads as "you may edit your own row", which sounds right and is not. The
-- row holds plan_id, storage_quota_bytes and status. Supabase grants UPDATE on
-- public tables to the authenticated role, and PostgREST is reachable with the
-- publishable key that every browser already has — so any signed-in account can
-- PATCH itself onto the Business plan with a terabyte of quota, or lift its own
-- suspension, without touching the application at all.
--
-- Confirmed against this database before writing it: PATCH returned 200 and the
-- row came back as plan_business.
--
-- An RLS policy says WHICH ROWS. It cannot say which columns, so the fix is
-- column-level privileges: revoke UPDATE and grant it back only on the fields a
-- person genuinely owns. The API writes through the service role, which bypasses
-- both, so nothing in the application changes.

begin;

-- ---------------------------------------------------------------------------
-- 1. Account setup
-- ---------------------------------------------------------------------------

-- ISO 3166-1 alpha-2. Two letters, stored uppercase, so a country is comparable
-- rather than a free-text guess at a name.
alter table public.user_storage add column if not exists country_code text;

-- The calling code is stored rather than derived. Several countries share one
-- (+1 covers twenty), so deriving it from the country would be wrong for most of
-- them, and a person who has moved may keep a number from where they came from.
alter table public.user_storage add column if not exists phone_country_code text;
alter table public.user_storage add column if not exists phone_number text;

-- One field, because the requirement is an address and not a shipping label.
-- Splitting it into street/city/postcode invites validation that is wrong for
-- most of the world.
alter table public.user_storage add column if not exists address text;

-- When setup was finished, not whether. A timestamp answers "has it been done"
-- as well as a boolean does, and also answers "when", which a boolean cannot.
alter table public.user_storage add column if not exists setup_completed_at timestamptz;

alter table public.user_storage drop constraint if exists user_storage_country_shape;
alter table public.user_storage
  add constraint user_storage_country_shape
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

alter table public.user_storage drop constraint if exists user_storage_phone_cc_shape;
alter table public.user_storage
  add constraint user_storage_phone_cc_shape
  check (phone_country_code is null or phone_country_code ~ '^\+[0-9]{1,4}$');

alter table public.user_storage drop constraint if exists user_storage_phone_shape;
alter table public.user_storage
  add constraint user_storage_phone_shape
  check (phone_number is null or phone_number ~ '^[0-9 ()\-]{4,20}$');

alter table public.user_storage drop constraint if exists user_storage_address_length;
alter table public.user_storage
  add constraint user_storage_address_length
  check (address is null or length(address) between 1 and 500);

-- Admin lists filter on who has finished setting up.
create index if not exists user_storage_setup_idx
  on public.user_storage (setup_completed_at)
  where setup_completed_at is null;

comment on column public.user_storage.country_code is 'ISO 3166-1 alpha-2, uppercase.';
comment on column public.user_storage.phone_country_code is 'Calling code with the plus, e.g. +880.';
comment on column public.user_storage.setup_completed_at is 'When the account setup wizard was finished; null means it has not been.';

-- ---------------------------------------------------------------------------
-- 2. A user may edit their own details — and nothing that costs money
-- ---------------------------------------------------------------------------

revoke update on public.user_storage from authenticated, anon;

-- Exactly the fields a person owns. plan_id, storage_quota_bytes, status and
-- developer_enabled are deliberately absent: they are decided by payment, by
-- support, or by the platform.
grant update (
  display_name,
  avatar_url,
  country_code,
  phone_country_code,
  phone_number,
  address,
  setup_completed_at
) on public.user_storage to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The same reasoning for files and folders
-- ---------------------------------------------------------------------------
--
-- "files_all" and "folders_all" are FOR ALL, so a user can also update their own
-- file rows — including size_bytes, which the quota trigger sums. Setting every
-- file to zero bytes empties the usage figure and the account can then upload
-- past its plan. Same shape of hole, same fix.
--
-- object_key and owner_id are excluded for a different reason: object_key is the
-- only link between a row and the bytes in storage, and a row that can be pointed
-- at another user's key is a way to read their file.

revoke update on public.files from authenticated, anon;
grant update (original_filename, folder_id, is_favorite, trashed_at, last_accessed_at)
  on public.files to authenticated;

revoke update on public.folders from authenticated, anon;
grant update (name, parent_id, is_favorite, is_pinned, icon, trashed_at, last_accessed_at)
  on public.folders to authenticated;

-- Inserting a file row directly would let someone register storage they never
-- uploaded, or claim a key they do not own. Uploads go through the API, which
-- checks the quota first and generates the key itself.
revoke insert on public.files from authenticated, anon;

commit;
