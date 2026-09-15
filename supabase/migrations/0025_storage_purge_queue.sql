-- Storage that has to be emptied after its database rows are gone.
--
-- Deleting an account removed its auth user, and every table cascades from that — but
-- file bytes are not in the database. They stayed in the bucket, stored and billed
-- indefinitely, belonging to nobody, after the user had been told their files were
-- removed.
--
-- Every object an account owns lives under "<user id>/" (checked: no exceptions), so
-- one row here names everything to remove. The account-delete route writes it; the
-- storage-purge job empties the prefix in bounded batches and removes the row when
-- nothing is left. Batches, because one request cannot make the thousands of storage
-- calls a large account needs.
--
-- Server-only. RLS on with no policies, and no grants to browser roles.

create table if not exists public.storage_purge_queue (
  prefix       text primary key,
  reason       text not null default 'account_deleted',
  enqueued_at  timestamptz not null default now(),
  attempts     integer not null default 0,
  last_error   text
);

alter table public.storage_purge_queue enable row level security;
revoke all on public.storage_purge_queue from anon, authenticated;
