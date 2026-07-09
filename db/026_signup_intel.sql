-- Signup intelligence: lead scoring columns + Frege-native signup monitor.
--
-- Scores are computed at write time by lib/core/lead-score.ts; existing rows
-- are backfilled with scripts/prototype/backfill-lead-scores.mjs.

alter table signups
  add column if not exists score integer;

alter table signups
  add column if not exists band text check (band in ('cold', 'warm', 'hot'));

-- In-app replacement for the external Hermes webhook consumer: every signal we
-- would have POSTed (signup created, stats snapshot) is persisted here instead.
create table if not exists signup_monitor_events (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists signup_monitor_events_type_created_idx
  on signup_monitor_events (event_type, created_at desc);
