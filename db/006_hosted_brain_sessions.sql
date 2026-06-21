-- Frege hosted brain and agent session ledger.

create extension if not exists pgcrypto;

alter table roles
  add column if not exists can_read_sessions boolean not null default false;

alter table roles
  add column if not exists can_write_sessions boolean not null default true;

alter table roles
  add column if not exists can_propose_memory boolean not null default false;

alter table roles
  add column if not exists can_review_memory_proposals boolean not null default false;

alter table roles
  add column if not exists can_manage_sources boolean not null default false;

alter table api_keys
  add column if not exists owner_user_id uuid references users(id) on delete set null;

create index if not exists api_keys_owner_user_idx
  on api_keys (owner_user_id);

update roles
set can_write_sessions = true
where slug in ('reader', 'writer', 'admin');

update roles
set
  can_read_sessions = true,
  can_propose_memory = true
where slug in ('writer', 'admin');

update roles
set
  can_review_memory_proposals = true,
  can_manage_sources = true
where slug = 'admin';

update api_keys
set owner_user_id = owners.user_id
from (
  select distinct on (org_id)
    org_id,
    user_id
  from organization_memberships
  where status = 'active'
    and role in ('owner', 'admin')
  order by org_id, (role = 'owner') desc, created_at asc
) owners
where api_keys.org_id = owners.org_id
  and api_keys.owner_user_id is null;

create table if not exists brain_sources (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  slug                text not null,
  name                text not null,
  kind                text not null default 'markdown',
  status              text not null default 'active',
  trust_zone          text not null default 'green',
  config              jsonb not null default '{}'::jsonb,
  metadata            jsonb not null default '{}'::jsonb,
  created_by_user_id  uuid references users(id) on delete set null,
  created_by_key_id   uuid references api_keys(id) on delete set null,
  approved_by_user_id uuid references users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (org_id, slug),

  constraint brain_sources_slug_format_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint brain_sources_status_chk
    check (status in ('active', 'disabled')),
  constraint brain_sources_trust_zone_chk
    check (trust_zone in ('green', 'red'))
);

create table if not exists brain_pages (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  source_id           uuid references brain_sources(id) on delete set null,
  slug                text not null,
  title               text not null,
  status              text not null default 'published',
  trust_zone          text not null default 'green',
  tags                text[] not null default array[]::text[],
  frontmatter         jsonb not null default '{}'::jsonb,
  created_by_user_id  uuid references users(id) on delete set null,
  created_by_key_id   uuid references api_keys(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (org_id, slug),

  constraint brain_pages_slug_format_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint brain_pages_status_chk
    check (status in ('draft', 'published', 'archived')),
  constraint brain_pages_trust_zone_chk
    check (trust_zone in ('green', 'red'))
);

create table if not exists brain_page_revisions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  page_id             uuid not null references brain_pages(id) on delete cascade,
  revision_number     integer not null,
  body_md             text not null,
  summary             text not null default '',
  proposal_id         uuid,
  created_by_user_id  uuid references users(id) on delete set null,
  created_by_key_id   uuid references api_keys(id) on delete set null,
  created_at          timestamptz not null default now(),

  unique (page_id, revision_number),

  constraint brain_page_revisions_revision_number_chk
    check (revision_number > 0)
);

create table if not exists brain_links (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  source_page_id      uuid not null references brain_pages(id) on delete cascade,
  target_page_id      uuid references brain_pages(id) on delete set null,
  target_slug         text not null,
  link_type           text not null default 'references',
  confidence          numeric not null default 1,
  evidence            text not null default '',
  created_by_user_id  uuid references users(id) on delete set null,
  created_by_key_id   uuid references api_keys(id) on delete set null,
  created_at          timestamptz not null default now(),

  constraint brain_links_type_chk
    check (link_type in ('references', 'supersedes', 'depends_on', 'related', 'contradicts')),
  constraint brain_links_confidence_chk
    check (confidence >= 0 and confidence <= 1)
);

create unique index if not exists brain_links_source_target_type_idx
  on brain_links (org_id, source_page_id, target_slug, link_type);

create table if not exists brain_sessions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  owner_user_id       uuid references users(id) on delete set null,
  actor_key_id        uuid references api_keys(id) on delete set null,
  external_id         text,
  client              text not null default 'unknown',
  title               text not null default 'Agent session',
  goal                text not null default '',
  status              text not null default 'active',
  trust_zone          text not null default 'green',
  metadata            jsonb not null default '{}'::jsonb,
  started_at          timestamptz not null default now(),
  last_event_at       timestamptz,
  ended_at            timestamptz,

  constraint brain_sessions_status_chk
    check (status in ('active', 'closed')),
  constraint brain_sessions_trust_zone_chk
    check (trust_zone in ('green', 'red'))
);

create unique index if not exists brain_sessions_org_external_id_idx
  on brain_sessions (org_id, external_id)
  where external_id is not null;

create table if not exists brain_session_events (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  session_id          uuid not null references brain_sessions(id) on delete cascade,
  actor_type          text not null,
  actor_user_id       uuid references users(id) on delete set null,
  actor_key_id        uuid references api_keys(id) on delete set null,
  event_type          text not null,
  body_md             text not null default '',
  payload             jsonb not null default '{}'::jsonb,
  trust_zone          text not null default 'green',
  source_ids          uuid[] not null default array[]::uuid[],
  request_id          text,
  created_at          timestamptz not null default now(),

  constraint brain_session_events_actor_type_chk
    check (actor_type in ('user', 'api_key', 'system')),
  constraint brain_session_events_type_chk
    check (event_type in (
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
      'context_build',
      'model_invoke',
      'memory_signal',
      'note'
    )),
  constraint brain_session_events_trust_zone_chk
    check (trust_zone in ('green', 'red'))
);

create table if not exists memory_proposals (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  proposal_type       text not null,
  target_page_id      uuid references brain_pages(id) on delete set null,
  target_source_id    uuid references brain_sources(id) on delete set null,
  slug                text,
  title               text not null default '',
  body_md             text not null default '',
  summary             text not null default '',
  trust_zone          text not null default 'green',
  source_ids          uuid[] not null default array[]::uuid[],
  session_id          uuid references brain_sessions(id) on delete set null,
  evidence_event_ids  uuid[] not null default array[]::uuid[],
  status              text not null default 'pending',
  created_by_user_id  uuid references users(id) on delete set null,
  created_by_key_id   uuid references api_keys(id) on delete set null,
  reviewer_user_id    uuid references users(id) on delete set null,
  resolved_at         timestamptz,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),

  constraint memory_proposals_type_chk
    check (proposal_type in ('page_create', 'page_update', 'source_create', 'link_update')),
  constraint memory_proposals_status_chk
    check (status in ('pending', 'accepted', 'rejected')),
  constraint memory_proposals_trust_zone_chk
    check (trust_zone in ('green', 'red')),
  constraint memory_proposals_slug_format_chk
    check (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')
);

create table if not exists context_build_brain_pages (
  context_build_id  uuid not null references context_builds(id) on delete cascade,
  page_id           uuid not null references brain_pages(id) on delete cascade,
  revision_id       uuid references brain_page_revisions(id) on delete set null,
  inclusion_reason  text not null default '',
  trust_zone        text not null default 'green',
  token_estimate    integer not null default 0,

  primary key (context_build_id, page_id),

  constraint context_build_brain_pages_trust_zone_chk
    check (trust_zone in ('green', 'red')),
  constraint context_build_brain_pages_token_estimate_chk
    check (token_estimate >= 0)
);

alter table context_builds
  add column if not exists session_id uuid references brain_sessions(id) on delete set null;

alter table telemetry_events
  add column if not exists session_id uuid references brain_sessions(id) on delete set null;

alter table telemetry_events
  add column if not exists session_event_id uuid references brain_session_events(id) on delete set null;

alter table telemetry_events
  add column if not exists context_build_id uuid references context_builds(id) on delete set null;

alter table telemetry_events
  add column if not exists proposal_id uuid references memory_proposals(id) on delete set null;

create index if not exists brain_sources_org_status_idx
  on brain_sources (org_id, status, updated_at desc);

create index if not exists brain_pages_org_status_idx
  on brain_pages (org_id, status, updated_at desc);

create index if not exists brain_pages_org_trust_zone_idx
  on brain_pages (org_id, trust_zone);

create index if not exists brain_pages_tags_idx
  on brain_pages using gin (tags);

create index if not exists brain_page_revisions_page_revision_idx
  on brain_page_revisions (page_id, revision_number desc);

create index if not exists brain_links_org_source_idx
  on brain_links (org_id, source_page_id);

create index if not exists brain_links_org_target_idx
  on brain_links (org_id, target_slug);

create index if not exists brain_sessions_org_recent_idx
  on brain_sessions (org_id, started_at desc);

create index if not exists brain_sessions_owner_recent_idx
  on brain_sessions (owner_user_id, started_at desc);

create index if not exists brain_session_events_session_recent_idx
  on brain_session_events (session_id, created_at desc);

create index if not exists brain_session_events_org_type_idx
  on brain_session_events (org_id, event_type, created_at desc);

create index if not exists memory_proposals_org_status_idx
  on memory_proposals (org_id, status, created_at desc);

create index if not exists memory_proposals_session_idx
  on memory_proposals (session_id, created_at desc);

create index if not exists context_build_brain_pages_page_idx
  on context_build_brain_pages (page_id);

create index if not exists context_builds_session_idx
  on context_builds (session_id, created_at desc);

create index if not exists telemetry_events_org_session_idx
  on telemetry_events (org_id, session_id, created_at desc);
