-- CloudCols — query-optimisation indexes.
-- Run after 0002. Covers the hot listing paths without over-indexing.

-- pg_trgm powers the ILIKE fuzzy search index on filenames.
create extension if not exists pg_trgm;

-- Files: the shared File-List engine filters by owner + visibility + drill-down.
create index if not exists files_owner_folder_idx on public.files(owner_id, folder_id, trashed_at);
create index if not exists files_owner_category_idx on public.files(owner_id, category, trashed_at);
create index if not exists files_owner_fav_idx on public.files(owner_id) where is_favorite = true;
create index if not exists files_owner_recent_idx on public.files(owner_id, last_accessed_at desc);
create index if not exists files_owner_trashed_idx on public.files(owner_id, trashed_at desc);
create index if not exists files_name_ilike_idx on public.files using gin (original_filename extensions.gin_trgm_ops);
create index if not exists files_object_key_idx on public.files(object_key);

-- Folders.
create index if not exists folders_owner_parent_idx on public.folders(owner_id, parent_id, trashed_at);
create index if not exists folders_path_idx on public.folders(path);

-- Shares/links resolved by token or file.
create index if not exists share_links_token_idx on public.share_links(token);
create index if not exists share_links_file_idx on public.share_links(file_id);

-- Admin / audit + activity scans.
create index if not exists files_status_idx on public.files(status);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);
