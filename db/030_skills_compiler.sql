-- Governed skills compiler foundations.

alter table brain_pages
  add column if not exists artifact_type text not null default 'page';

alter table brain_pages
  add column if not exists valid_from timestamptz,
  add column if not exists invalidated_at timestamptz,
  add column if not exists superseded_by uuid,
  add column if not exists stale_flagged_at timestamptz,
  add column if not exists stale_reason text;

alter table brain_pages
  drop constraint if exists brain_pages_artifact_type_chk;

alter table brain_pages
  add constraint brain_pages_artifact_type_chk
    check (artifact_type in ('page', 'skill'));

alter table memory_proposals
  drop constraint if exists memory_proposals_type_chk;

alter table memory_proposals
  add constraint memory_proposals_type_chk
    check (proposal_type in (
      'page_create',
      'page_update',
      'source_create',
      'link_update',
      'skill_create',
      'skill_update'
    ));

create table if not exists raw_materials (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  source_type    text not null,
  content_md     text not null,
  provenance     jsonb not null,
  occurred_at    timestamptz,
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  compiled_at    timestamptz,
  compile_result text,

  constraint raw_materials_source_type_chk
    check (source_type in ('session', 'markdown_upload'))
);
