-- Frege backend v0 control plane, context gateway, model configs, and telemetry.

create extension if not exists pgcrypto;

create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  name           text not null,
  status         text not null default 'active',
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz,

  constraint users_email_format_chk
    check (email = lower(email) and position('@' in email) > 1),
  constraint users_status_chk
    check (status in ('active', 'disabled'))
);

create unique index if not exists users_email_lower_idx
  on users (lower(email));

create table if not exists user_password_credentials (
  user_id          uuid primary key references users(id) on delete cascade,
  password_hash    text not null,
  password_salt    text not null,
  password_params  jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

create table if not exists user_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  session_hash  text not null unique,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,

  constraint user_sessions_status_chk
    check (status in ('active', 'revoked'))
);

create index if not exists user_sessions_user_idx
  on user_sessions (user_id, created_at desc);

create table if not exists organization_memberships (
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        text not null default 'member',
  status      text not null default 'active',
  created_at  timestamptz not null default now(),

  primary key (org_id, user_id),

  constraint organization_memberships_role_chk
    check (role in ('owner', 'admin', 'member', 'viewer')),
  constraint organization_memberships_status_chk
    check (status in ('active', 'disabled'))
);

create index if not exists organization_memberships_user_idx
  on organization_memberships (user_id, status);

create table if not exists organization_invites (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  email               text not null,
  role                text not null default 'member',
  invited_by_user_id  uuid references users(id) on delete set null,
  invite_token_hash   text not null unique,
  status              text not null default 'pending',
  expires_at          timestamptz not null,
  accepted_at         timestamptz,
  created_at          timestamptz not null default now(),

  constraint organization_invites_email_format_chk
    check (email = lower(email) and position('@' in email) > 1),
  constraint organization_invites_role_chk
    check (role in ('owner', 'admin', 'member', 'viewer')),
  constraint organization_invites_status_chk
    check (status in ('pending', 'accepted', 'revoked', 'expired'))
);

create index if not exists organization_invites_org_status_idx
  on organization_invites (org_id, status, created_at desc);

alter table knowledge_documents
  add column if not exists trust_zone text not null default 'green';

alter table knowledge_documents
  drop constraint if exists knowledge_documents_trust_zone_chk;

alter table knowledge_documents
  add constraint knowledge_documents_trust_zone_chk
    check (trust_zone in ('green', 'red'));

update knowledge_documents
set trust_zone = case
  when sensitivity = 'restricted' then 'red'
  else 'green'
end
where trust_zone is null
  or (sensitivity = 'restricted' and trust_zone <> 'red');

create index if not exists knowledge_documents_org_trust_zone_idx
  on knowledge_documents (org_id, trust_zone);

create table if not exists org_model_configs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  slug                text not null,
  name                text not null,
  provider            text not null,
  base_url            text,
  model_name          text not null,
  allowed_trust_zones text[] not null default array['green']::text[],
  encrypted_api_key   text,
  status              text not null default 'active',
  created_by_user_id  uuid references users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (org_id, slug),

  constraint org_model_configs_slug_format_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint org_model_configs_provider_chk
    check (provider in ('openrouter', 'ollama')),
  constraint org_model_configs_allowed_trust_zones_chk
    check (allowed_trust_zones <@ array['green', 'red']::text[]),
  constraint org_model_configs_status_chk
    check (status in ('active', 'disabled'))
);

create index if not exists org_model_configs_org_status_idx
  on org_model_configs (org_id, status);

create table if not exists context_builds (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  actor_type      text not null,
  actor_user_id   uuid references users(id) on delete set null,
  actor_key_id    uuid references api_keys(id) on delete set null,
  query           text not null,
  source_slug     text,
  trust_zone      text not null default 'green',
  token_estimate  integer not null default 0,
  denied_count    integer not null default 0,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),

  constraint context_builds_actor_type_chk
    check (actor_type in ('user', 'api_key', 'system')),
  constraint context_builds_trust_zone_chk
    check (trust_zone in ('green', 'red')),
  constraint context_builds_token_estimate_chk
    check (token_estimate >= 0),
  constraint context_builds_denied_count_chk
    check (denied_count >= 0)
);

create index if not exists context_builds_org_created_at_idx
  on context_builds (org_id, created_at desc);

create table if not exists context_build_documents (
  context_build_id  uuid not null references context_builds(id) on delete cascade,
  document_id       uuid not null references knowledge_documents(id) on delete cascade,
  revision_id       uuid references knowledge_document_revisions(id) on delete set null,
  chunk_ids         uuid[] not null default array[]::uuid[],
  inclusion_reason  text not null default '',
  trust_zone        text not null default 'green',
  token_estimate    integer not null default 0,

  primary key (context_build_id, document_id),

  constraint context_build_documents_trust_zone_chk
    check (trust_zone in ('green', 'red')),
  constraint context_build_documents_token_estimate_chk
    check (token_estimate >= 0)
);

create table if not exists telemetry_events (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid references organizations(id) on delete cascade,
  actor_type           text not null default 'system',
  actor_user_id        uuid references users(id) on delete set null,
  actor_key_id         uuid references api_keys(id) on delete set null,
  request_id           text not null,
  action               text not null,
  resource_type        text,
  resource_id          uuid,
  outcome              text not null,
  latency_ms           integer,
  provider             text,
  model                text,
  input_tokens         integer,
  output_tokens        integer,
  estimated_cost_usd   numeric,
  trust_zone           text,
  ip_hash              text,
  user_agent           text,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),

  constraint telemetry_events_actor_type_chk
    check (actor_type in ('user', 'api_key', 'system')),
  constraint telemetry_events_outcome_chk
    check (outcome in ('success', 'failure', 'denied')),
  constraint telemetry_events_trust_zone_chk
    check (trust_zone is null or trust_zone in ('green', 'red'))
);

create index if not exists telemetry_events_org_created_at_idx
  on telemetry_events (org_id, created_at desc);

create index if not exists telemetry_events_org_action_idx
  on telemetry_events (org_id, action, created_at desc);

create index if not exists telemetry_events_org_outcome_idx
  on telemetry_events (org_id, outcome, created_at desc);
