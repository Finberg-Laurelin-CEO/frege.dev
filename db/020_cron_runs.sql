-- Cron run history + alerting ledger. recordCronRun() (lib/core/cron-run.ts)
-- writes one row per tick so a repeatedly-failing cron job is never silent.

create table if not exists cron_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  status text not null default 'running',
  ok boolean,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  detail jsonb not null default '{}'::jsonb,
  error text,
  constraint cron_runs_status_chk check (status in ('running', 'ok', 'failed'))
);

create index if not exists cron_runs_job_started_idx on cron_runs (job, started_at desc);
