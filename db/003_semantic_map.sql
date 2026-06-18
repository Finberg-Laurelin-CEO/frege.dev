-- Frege prototype semantic map — chunks, explicit links, concepts,
-- document/concept memberships, and index run history.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists knowledge_chunks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  document_id      uuid not null references knowledge_documents(id) on delete cascade,
  revision_id      uuid not null references knowledge_document_revisions(id) on delete cascade,
  chunk_index      integer not null,
  body_md          text not null,
  token_count      integer not null default 0,
  embedding_model  text,
  embedding        vector(1536),
  created_at       timestamptz not null default now(),

  unique (revision_id, chunk_index),

  constraint knowledge_chunks_chunk_index_chk
    check (chunk_index >= 0),
  constraint knowledge_chunks_token_count_chk
    check (token_count >= 0)
);

create table if not exists document_links (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  source_document_id  uuid not null references knowledge_documents(id) on delete cascade,
  target_document_id  uuid not null references knowledge_documents(id) on delete cascade,
  source_revision_id  uuid references knowledge_document_revisions(id) on delete set null,
  link_type           text not null,
  confidence          numeric not null default 1,
  evidence            text not null default '',
  created_by_key_id   uuid references api_keys(id) on delete set null,
  created_at          timestamptz not null default now(),

  unique (source_document_id, target_document_id, link_type),

  constraint document_links_no_self_link_chk
    check (source_document_id <> target_document_id),
  constraint document_links_type_chk
    check (link_type in ('references', 'supersedes', 'depends_on', 'related', 'contradicts')),
  constraint document_links_confidence_chk
    check (confidence >= 0 and confidence <= 1)
);

create table if not exists concept_nodes (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  slug             text not null,
  name             text not null,
  description      text not null default '',
  embedding_model  text,
  embedding        vector(1536),
  created_at       timestamptz not null default now(),

  unique (org_id, slug),

  constraint concept_nodes_slug_format_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')
);

create table if not exists concept_edges (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  source_concept_id  uuid not null references concept_nodes(id) on delete cascade,
  target_concept_id  uuid not null references concept_nodes(id) on delete cascade,
  edge_type          text not null,
  weight             numeric not null default 1,
  evidence           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),

  unique (source_concept_id, target_concept_id, edge_type),

  constraint concept_edges_no_self_edge_chk
    check (source_concept_id <> target_concept_id),
  constraint concept_edges_type_chk
    check (edge_type in ('related_to', 'depends_on', 'contradicts', 'supersedes')),
  constraint concept_edges_weight_chk
    check (weight >= 0 and weight <= 1)
);

create table if not exists document_concepts (
  org_id       uuid not null references organizations(id) on delete cascade,
  document_id  uuid not null references knowledge_documents(id) on delete cascade,
  concept_id   uuid not null references concept_nodes(id) on delete cascade,
  confidence   numeric not null default 1,
  created_at   timestamptz not null default now(),

  primary key (document_id, concept_id),

  constraint document_concepts_confidence_chk
    check (confidence >= 0 and confidence <= 1)
);

create table if not exists semantic_index_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  document_id   uuid references knowledge_documents(id) on delete set null,
  revision_id   uuid references knowledge_document_revisions(id) on delete set null,
  status        text not null default 'pending',
  error         text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,

  constraint semantic_index_runs_status_chk
    check (status in ('pending', 'running', 'succeeded', 'failed'))
);

create index if not exists knowledge_chunks_org_document_idx
  on knowledge_chunks (org_id, document_id);

create index if not exists knowledge_chunks_revision_idx
  on knowledge_chunks (revision_id, chunk_index);

create index if not exists document_links_org_source_idx
  on document_links (org_id, source_document_id);

create index if not exists document_links_org_target_idx
  on document_links (org_id, target_document_id);

create index if not exists concept_nodes_org_name_idx
  on concept_nodes (org_id, name);

create index if not exists concept_edges_org_source_idx
  on concept_edges (org_id, source_concept_id);

create index if not exists concept_edges_org_target_idx
  on concept_edges (org_id, target_concept_id);

create index if not exists document_concepts_org_concept_idx
  on document_concepts (org_id, concept_id);

create index if not exists semantic_index_runs_org_created_at_idx
  on semantic_index_runs (org_id, created_at desc);
