-- api_usage_daily could never hold a row.
--
-- Its api_key_id references legacy_api_keys — the prototype table that was set aside —
-- so every write for a real key violated the foreign key. The same mistake as
-- webhook_deliveries in migration 0022: a table left pointing at the prototype after
-- the real one replaced it.
--
-- Nothing depends on the rollup today: the Developer API counts a month's requests from
-- api_request_logs, which is also what the usage dashboard reads. Repointing it here
-- means the daily rollup can be used for that count later, on a table small enough to
-- sum cheaply however large the log grows.
--
-- The index is for the count that runs on every /v1 request until then.

alter table public.api_usage_daily drop constraint if exists api_usage_daily_api_key_id_fkey;
alter table public.api_usage_daily
  add constraint api_usage_daily_api_key_id_fkey
  foreign key (api_key_id) references public.api_keys(id) on delete cascade;

create index if not exists api_request_logs_user_created_idx
  on public.api_request_logs (user_id, created_at desc);
