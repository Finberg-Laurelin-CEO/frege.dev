-- Frege hosted agent definitions, queued runs, and runtime execution packets.

create extension if not exists pgcrypto;

alter table roles
  add column if not exists can_execute_agents boolean not null default false;

update roles
set can_execute_agents = true
where slug in ('writer', 'admin');

create table if not exists agent_definitions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  slug                text not null,
  name                text not null,
  description         text not null default '',
  instructions_md     text not null,
  model_config_id     uuid not null references org_model_configs(id) on delete restrict,
  status              text not null default 'active',
  trust_zone          text not null default 'green',
  default_context_query text not null default '',
  max_steps           integer not null default 1,
  created_by_user_id  uuid references users(id) on delete set null,
  created_by_key_id   uuid references api_keys(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (org_id, slug),

  constraint agent_definitions_slug_format_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint agent_definitions_status_chk
    check (status in ('active', 'disabled')),
  constraint agent_definitions_trust_zone_chk
    check (trust_zone in ('green', 'red')),
  constraint agent_definitions_max_steps_chk
    check (max_steps >= 1 and max_steps <= 10)
);

create table if not exists agent_runs (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  agent_id              uuid not null references agent_definitions(id) on delete restrict,
  model_config_id       uuid not null references org_model_configs(id) on delete restrict,
  session_id            uuid references brain_sessions(id) on delete set null,
  requested_by_user_id  uuid references users(id) on delete set null,
  requested_by_key_id   uuid references api_keys(id) on delete set null,
  status                text not null default 'queued',
  input_md              text not null,
  context_query         text not null default '',
  result_md             text not null default '',
  error                 text,
  trust_zone            text not null default 'green',
  context_build_id      uuid references context_builds(id) on delete set null,
  allowed_labels        text[] not null default array['public']::text[],
  actor_snapshot        jsonb not null default '{}'::jsonb,
  max_steps             integer not null default 1,
  lease_owner           text,
  lease_expires_at      timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint agent_runs_status_chk
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint agent_runs_trust_zone_chk
    check (trust_zone in ('green', 'red')),
  constraint agent_runs_allowed_labels_chk
    check (allowed_labels <@ array['public', 'internal', 'restricted']::text[]),
  constraint agent_runs_max_steps_chk
    check (max_steps >= 1 and max_steps <= 10)
);

create table if not exists agent_run_steps (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  run_id      uuid not null references agent_runs(id) on delete cascade,
  step_index  integer not null,
  step_type   text not null,
  body_md     text not null default '',
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  unique (run_id, step_index),

  constraint agent_run_steps_index_chk
    check (step_index >= 0),
  constraint agent_run_steps_type_chk
    check (step_type in ('queued', 'context_build', 'model_call', 'complete', 'error', 'note'))
);

create index if not exists agent_definitions_org_status_idx
  on agent_definitions (org_id, status, updated_at desc);

create index if not exists agent_runs_org_status_idx
  on agent_runs (org_id, status, created_at desc);

create index if not exists agent_runs_queue_idx
  on agent_runs (status, created_at asc)
  where status = 'queued';

create index if not exists agent_runs_session_idx
  on agent_runs (session_id, created_at desc);

create index if not exists agent_run_steps_run_idx
  on agent_run_steps (run_id, step_index asc);
