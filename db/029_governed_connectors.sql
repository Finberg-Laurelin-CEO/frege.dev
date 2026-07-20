-- Governed connector contract and GitHub beta persistence.
--
-- Connector records are tenant-bound with composite foreign keys. External
-- identities use provider-issued IDs and exact source paths; display names and
-- generated slugs are never treated as identity. Tokens and webhook payloads
-- are deliberately not stored.

create extension if not exists pgcrypto;

create unique index if not exists brain_sources_org_id_id_idx
  on brain_sources (org_id, id);

create unique index if not exists brain_pages_org_id_id_idx
  on brain_pages (org_id, id);

create unique index if not exists brain_page_revisions_org_id_id_idx
  on brain_page_revisions (org_id, id);

create unique index if not exists brain_page_revisions_org_page_id_idx
  on brain_page_revisions (org_id, page_id, id);

create table if not exists connector_setup_states (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  user_id                   uuid not null references users(id) on delete cascade,
  provider                  text not null,
  state_hash                text not null unique,
  external_installation_id  text,
  expires_at                timestamptz not null,
  consumed_at               timestamptz,
  created_at                timestamptz not null default now(),

  constraint connector_setup_states_provider_chk
    check (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint connector_setup_states_hash_chk
    check (state_hash ~ '^[a-f0-9]{64}$'),
  constraint connector_setup_states_window_chk
    check (expires_at > created_at)
);

create index if not exists connector_setup_states_org_user_recent_idx
  on connector_setup_states (org_id, user_id, created_at desc);

create table if not exists connector_installations (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  provider                  text not null,
  external_installation_id  text not null,
  account_id                text not null,
  account_login             text not null,
  status                    text not null default 'active',
  requested_scopes          jsonb not null default '{}'::jsonb,
  external_acl              jsonb not null default '{}'::jsonb,
  created_by_principal_id   uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (org_id, id),
  unique (org_id, id, provider),
  unique (provider, external_installation_id),

  foreign key (org_id, created_by_principal_id)
    references control_principals(org_id, id) on delete restrict,

  constraint connector_installations_provider_chk
    check (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint connector_installations_status_chk
    check (status in ('active', 'suspended', 'revoked')),
  constraint connector_installations_external_id_chk
    check (length(external_installation_id) between 1 and 200),
  constraint connector_installations_account_id_chk
    check (length(account_id) between 1 and 200),
  constraint connector_installations_scopes_chk
    check (jsonb_typeof(requested_scopes) = 'object'),
  constraint connector_installations_acl_chk
    check (jsonb_typeof(external_acl) = 'object')
);

create index if not exists connector_installations_org_provider_status_idx
  on connector_installations (org_id, provider, status, updated_at desc);

create table if not exists connector_sources (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  installation_id          uuid not null,
  provider                 text not null,
  external_resource_id     text not null,
  display_name             text not null,
  source_id                uuid not null,
  service_principal_id     uuid not null,
  managed_credential_id    uuid not null,
  policy_version_id        uuid not null,
  generation               integer not null default 1,
  source_ref               text not null default 'HEAD',
  status                   text not null default 'active',
  health_status            text not null default 'pending',
  config                   jsonb not null default '{}'::jsonb,
  external_acl             jsonb not null default '{}'::jsonb,
  sync_cursor              text,
  etag                     text,
  last_attempt_at          timestamptz,
  last_success_at          timestamptz,
  last_error_code          text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (org_id, id),
  unique (provider, external_resource_id),

  foreign key (org_id, installation_id, provider)
    references connector_installations(org_id, id, provider) on delete cascade,
  foreign key (org_id, source_id)
    references brain_sources(org_id, id) on delete restrict,
  foreign key (org_id, service_principal_id)
    references control_principals(org_id, id) on delete restrict,
  foreign key (org_id, managed_credential_id)
    references delegated_credentials(org_id, id) on delete restrict,
  foreign key (org_id, policy_version_id)
    references control_policy_versions(org_id, id) on delete restrict,

  constraint connector_sources_provider_chk
    check (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint connector_sources_external_id_chk
    check (length(external_resource_id) between 1 and 200),
  constraint connector_sources_ref_chk
    check (length(source_ref) between 1 and 240),
  constraint connector_sources_generation_chk
    check (generation > 0),
  constraint connector_sources_status_chk
    check (status in ('active', 'disabled', 'revoked')),
  constraint connector_sources_health_chk
    check (health_status in ('pending', 'healthy', 'degraded', 'revoked')),
  constraint connector_sources_config_chk
    check (jsonb_typeof(config) = 'object'),
  constraint connector_sources_acl_chk
    check (jsonb_typeof(external_acl) = 'object')
);

create index if not exists connector_sources_org_provider_status_idx
  on connector_sources (org_id, provider, status, updated_at desc);

create index if not exists connector_sources_installation_idx
  on connector_sources (org_id, installation_id, status);

create table if not exists connector_source_items (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  connector_source_id      uuid not null,
  external_item_id         text not null,
  source_path              text not null,
  external_revision        text not null,
  size_bytes               integer not null,
  page_id                  uuid not null,
  page_revision_id         uuid not null,
  status                   text not null default 'active',
  last_seen_cursor         text not null,
  synced_at                timestamptz not null default now(),
  deleted_at               timestamptz,

  unique (org_id, id),
  unique (org_id, connector_source_id, external_item_id),
  unique (org_id, connector_source_id, source_path),
  unique (org_id, connector_source_id, page_id),

  foreign key (org_id, connector_source_id)
    references connector_sources(org_id, id) on delete cascade,
  foreign key (org_id, page_id)
    references brain_pages(org_id, id) on delete restrict,
  foreign key (org_id, page_revision_id)
    references brain_page_revisions(org_id, id) on delete restrict,
  foreign key (org_id, page_id, page_revision_id)
    references brain_page_revisions(org_id, page_id, id) on delete restrict,

  constraint connector_source_items_external_id_chk
    check (length(external_item_id) between 1 and 1024),
  constraint connector_source_items_path_chk
    check (length(source_path) between 1 and 1024),
  constraint connector_source_items_revision_chk
    check (length(external_revision) between 1 and 200),
  constraint connector_source_items_size_chk
    check (size_bytes >= 0),
  constraint connector_source_items_status_chk
    check (status in ('active', 'deleted')),
  constraint connector_source_items_deleted_at_chk
    check (
      (status = 'active' and deleted_at is null)
      or (status = 'deleted' and deleted_at is not null)
    )
);

create index if not exists connector_source_items_source_status_idx
  on connector_source_items (org_id, connector_source_id, status, source_path);

create table if not exists connector_sync_runs (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  connector_source_id       uuid not null,
  trigger_kind              text not null,
  status                    text not null default 'running',
  idempotency_key           text not null,
  attempt_number            integer not null default 1,
  correlation_id            uuid not null,
  authorization_receipt_id  uuid not null,
  config_digest              text not null,
  connector_generation       integer not null,
  lease_token                uuid not null,
  lease_expires_at           timestamptz not null,
  snapshot_authoritative     boolean not null default false,
  deletion_applied           boolean not null default false,
  cursor_from               text,
  cursor_to                 text,
  selected_count            integer not null default 0,
  fetched_count             integer not null default 0,
  created_count             integer not null default 0,
  updated_count             integer not null default 0,
  deleted_count             integer not null default 0,
  unchanged_count           integer not null default 0,
  error_code                text,
  started_at                timestamptz not null default now(),
  finished_at               timestamptz,
  retry_after               timestamptz,

  unique (org_id, id),
  unique (org_id, connector_source_id, idempotency_key),

  foreign key (org_id, connector_source_id)
    references connector_sources(org_id, id) on delete cascade,
  foreign key (org_id, authorization_receipt_id)
    references authorization_receipts(org_id, id) on delete restrict,

  constraint connector_sync_runs_trigger_chk
    check (trigger_kind in ('initial', 'manual', 'webhook', 'retry')),
  constraint connector_sync_runs_status_chk
    check (status in ('running', 'succeeded', 'noop', 'failed')),
  constraint connector_sync_runs_idempotency_chk
    check (length(idempotency_key) between 1 and 240),
  constraint connector_sync_runs_config_digest_chk
    check (config_digest ~ '^[a-f0-9]{64}$'),
  constraint connector_sync_runs_generation_chk
    check (connector_generation > 0),
  constraint connector_sync_runs_attempt_chk
    check (attempt_number > 0),
  constraint connector_sync_runs_counts_chk
    check (
      selected_count >= 0 and fetched_count >= 0 and created_count >= 0
      and updated_count >= 0 and deleted_count >= 0 and unchanged_count >= 0
    )
);

create unique index if not exists connector_sync_runs_one_running_idx
  on connector_sync_runs (org_id, connector_source_id)
  where status = 'running';

create index if not exists connector_sync_runs_source_recent_idx
  on connector_sync_runs (org_id, connector_source_id, started_at desc);

create table if not exists connector_webhook_deliveries (
  id                        uuid primary key default gen_random_uuid(),
  provider                  text not null,
  delivery_id               text not null,
  event_name                text not null,
  event_action              text,
  payload_sha256            text not null,
  external_installation_id  text,
  external_resource_id      text,
  org_id                    uuid references organizations(id) on delete cascade,
  connector_source_id       uuid,
  status                    text not null default 'received',
  attempt_count             integer not null default 0,
  error_code                text,
  received_at               timestamptz not null default now(),
  processing_started_at     timestamptz,
  lease_expires_at          timestamptz,
  processed_at              timestamptz,

  unique (provider, delivery_id),

  foreign key (org_id, connector_source_id)
    references connector_sources(org_id, id) on delete cascade,

  constraint connector_webhook_deliveries_provider_chk
    check (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint connector_webhook_deliveries_delivery_id_chk
    check (length(delivery_id) between 1 and 240),
  constraint connector_webhook_deliveries_event_chk
    check (event_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint connector_webhook_deliveries_payload_digest_chk
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint connector_webhook_deliveries_status_chk
    check (status in ('received', 'processing', 'ignored', 'processed', 'failed')),
  constraint connector_webhook_deliveries_attempt_chk
    check (attempt_count >= 0),
  constraint connector_webhook_deliveries_tenant_ref_chk
    check (connector_source_id is null or org_id is not null)
);

create index if not exists connector_webhook_deliveries_source_recent_idx
  on connector_webhook_deliveries (org_id, connector_source_id, received_at desc)
  where connector_source_id is not null;
