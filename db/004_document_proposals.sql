-- Frege prototype document proposals — safe write path that does not
-- overwrite published revisions.

create extension if not exists pgcrypto;

create table if not exists document_revision_proposals (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  document_id        uuid not null references knowledge_documents(id) on delete cascade,
  base_revision_id   uuid not null references knowledge_document_revisions(id) on delete restrict,
  proposed_body_md   text not null,
  summary            text not null default '',
  status             text not null default 'pending',
  created_by_key_id  uuid references api_keys(id) on delete set null,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,

  constraint document_revision_proposals_status_chk
    check (status in ('pending', 'accepted', 'rejected'))
);

create index if not exists document_revision_proposals_org_document_idx
  on document_revision_proposals (org_id, document_id, created_at desc);

create index if not exists document_revision_proposals_org_status_idx
  on document_revision_proposals (org_id, status, created_at desc);
