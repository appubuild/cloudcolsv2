-- webhook_deliveries.webhook_id still referenced the prototype legacy_webhooks
-- table, left over from when the prototype tables were set aside. Every delivery-log
-- insert for an application webhook failed that FK, so developers had a delivery
-- log that never recorded a delivery. Both tables were empty when this ran, so
-- repointing it loses nothing.

alter table public.webhook_deliveries drop constraint if exists webhook_deliveries_webhook_id_fkey;
alter table public.webhook_deliveries
  add constraint webhook_deliveries_webhook_id_fkey
  foreign key (webhook_id) references public.webhooks(id) on delete cascade;
