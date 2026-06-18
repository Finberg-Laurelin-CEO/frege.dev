-- Frege prototype core — orgs, roles, API keys, markdown documents,
-- immutable revisions, and audit events.
--
-- This is the first product-prototype schema. It intentionally does not include
-- embeddings or semantic-map tables; those land in db/003_semantic_map.sql after
-- the permissioned read API exists.

create extension if not exists pgcrypto;

create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now(),

  constraint organizations_slug_format_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')
);

create table if not exists roles (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  slug              text not null,
  name              text not null,
  can_read_labels   text[] not null default array['public']::text[],
  can_create_docs   boolean not null default false,
  can_update_docs   boolean not null default false,
  can_read_audit    boolean not null default false,
  created_at        timestamptz not null default now(),

  unique (id, org_id),
  unique (org_id, slug),

  constraint roles_slug_format_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint roles_can_read_labels_chk
    check (can_read_labels <@ array['public', 'internal', 'restricted']::text[])
);

create table if not exists api_keys (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  role_id       uuid not null,
  name          text not null,
  key_prefix    text not null unique,
  key_hash      text not null unique,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,

  foreign key (role_id, org_id) references roles(id, org_id) on delete restrict,

  constraint api_keys_status_chk
    check (status in ('active', 'revoked'))
);

create table if not exists knowledge_documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  slug         text not null,
  path         text not null,
  title        text not null,
  sensitivity  text not null default 'internal',
  status       text not null default 'draft',
  tags         text[] not null default array[]::text[],
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (org_id, slug),
  unique (org_id, path),

  constraint knowledge_documents_slug_format_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint knowledge_documents_sensitivity_chk
    check (sensitivity in ('public', 'internal', 'restricted')),
  constraint knowledge_documents_status_chk
    check (status in ('draft', 'published', 'archived'))
);

create table if not exists knowledge_document_revisions (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references knowledge_documents(id) on delete cascade,
  revision_number    integer not null,
  body_md            text not null,
  summary            text not null default '',
  created_by_key_id  uuid references api_keys(id) on delete set null,
  created_at         timestamptz not null default now(),

  unique (document_id, revision_number),

  constraint knowledge_document_revisions_revision_number_chk
    check (revision_number > 0)
);

create table if not exists audit_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  actor_key_id   uuid references api_keys(id) on delete set null,
  action         text not null,
  resource_type  text,
  resource_id    uuid,
  ip_hash        text,
  user_agent     text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists api_keys_prefix_idx
  on api_keys (key_prefix);

create index if not exists roles_org_slug_idx
  on roles (org_id, slug);

create index if not exists knowledge_documents_org_slug_idx
  on knowledge_documents (org_id, slug);

create index if not exists knowledge_documents_org_path_idx
  on knowledge_documents (org_id, path);

create index if not exists knowledge_documents_org_sensitivity_idx
  on knowledge_documents (org_id, sensitivity);

create index if not exists knowledge_documents_tags_idx
  on knowledge_documents using gin (tags);

create index if not exists knowledge_document_revisions_document_revision_idx
  on knowledge_document_revisions (document_id, revision_number desc);

create index if not exists audit_events_org_created_at_idx
  on audit_events (org_id, created_at desc);

create index if not exists audit_events_org_action_idx
  on audit_events (org_id, action);
