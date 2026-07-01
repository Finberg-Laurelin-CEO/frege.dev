-- Stripe webhook processing ledger.
-- Keeps webhook retries idempotent and records handler failures for replay.

create table if not exists stripe_webhook_events (
  event_id text primary key,
  type text,
  event_created bigint,
  status text not null default 'processing',
  received_at timestamptz default now(),
  processed_at timestamptz,
  error text
);

alter table org_billing
  add column if not exists last_event_created bigint;
