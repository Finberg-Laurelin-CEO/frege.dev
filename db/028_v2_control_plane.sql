-- Frege v2 control-plane vertical slice.
--
-- This migration is additive. The v1 role/api_keys model remains unchanged.
-- V2 credentials are bound to an explicit principal, an organization, an
-- immutable policy version, and a non-empty set of action scopes.

create extension if not exists pgcrypto;

-- Composite subject references below make an agent definition's organization
-- part of the foreign key, rather than trusting a globally unique UUID alone.
alter table agent_definitions
  add constraint agent_definitions_org_id_id_key unique (org_id, id);

create table if not exists control_principals (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  principal_type           text not null,
  slug                     text not null,
  name                     text not null,
  status                   text not null default 'active',
  subject_user_id          uuid,
  subject_agent_id         uuid,
  created_by_principal_id  uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (org_id, id),
  unique (org_id, slug),
  unique (org_id, subject_user_id),
  unique (org_id, subject_agent_id),

  foreign key (org_id, created_by_principal_id)
    references control_principals(org_id, id) on delete restrict,
  foreign key (org_id, subject_user_id)
    references organization_memberships(org_id, user_id) on delete restrict,
  foreign key (org_id, subject_agent_id)
    references agent_definitions(org_id, id) on delete restrict,

  constraint control_principals_type_chk
    check (principal_type in ('human', 'agent', 'service')),
  constraint control_principals_status_chk
    check (status in ('active', 'disabled')),
  constraint control_principals_slug_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint control_principals_subject_shape_chk
    check (
      (principal_type = 'human' and subject_user_id is not null and subject_agent_id is null)
      or (principal_type = 'agent' and subject_user_id is null and subject_agent_id is not null)
      or (principal_type = 'service' and subject_user_id is null and subject_agent_id is null)
    )
);

create index if not exists control_principals_org_type_status_idx
  on control_principals (org_id, principal_type, status, created_at desc);

-- Preserve an attributable identity for every existing human membership and
-- hosted agent. Subjects use a disable lifecycle; hard deletion is restricted
-- while an attributable principal exists.
insert into control_principals (
  org_id,
  principal_type,
  slug,
  name,
  status,
  subject_user_id
)
select
  memberships.org_id,
  'human',
  'human-' || left(replace(memberships.user_id::text, '-', ''), 16),
  users.name,
  case
    when memberships.status = 'active' and users.status = 'active' then 'active'
    else 'disabled'
  end,
  memberships.user_id
from organization_memberships memberships
join users on users.id = memberships.user_id
on conflict do nothing;

insert into control_principals (
  org_id,
  principal_type,
  slug,
  name,
  status,
  subject_agent_id
)
select
  agents.org_id,
  'agent',
  'agent-' || left(replace(agents.id::text, '-', ''), 16),
  agents.name,
  agents.status,
  agents.id
from agent_definitions agents
on conflict do nothing;

create table if not exists control_policy_versions (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  slug                     text not null,
  version                  integer not null,
  default_decision         text not null default 'deny',
  rules                    jsonb not null default '[]'::jsonb,
  rules_digest             text not null,
  created_by_principal_id  uuid,
  created_at               timestamptz not null default now(),

  unique (org_id, id),
  unique (org_id, slug, version),

  foreign key (org_id, created_by_principal_id)
    references control_principals(org_id, id) on delete restrict,

  constraint control_policy_versions_slug_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint control_policy_versions_version_chk
    check (version > 0),
  constraint control_policy_versions_default_deny_chk
    check (default_decision = 'deny'),
  constraint control_policy_versions_rules_chk
    check (jsonb_typeof(rules) = 'array'),
  constraint control_policy_versions_digest_chk
    check (rules_digest ~ '^[a-f0-9]{64}$')
);

create index if not exists control_policy_versions_org_slug_version_idx
  on control_policy_versions (org_id, slug, version desc);

-- Every organization begins with an immutable policy that allows nothing.
-- Publishing an allow rule requires an explicit v2 policy version.
insert into control_policy_versions (
  org_id,
  slug,
  version,
  default_decision,
  rules,
  rules_digest
)
select
  organizations.id,
  'baseline',
  1,
  'deny',
  '[]'::jsonb,
  encode(digest('[]', 'sha256'), 'hex')
from organizations
on conflict (org_id, slug, version) do nothing;

create or replace function frege_v2_seed_baseline_policy()
returns trigger
language plpgsql
as $$
begin
  insert into control_policy_versions (
    org_id,
    slug,
    version,
    default_decision,
    rules,
    rules_digest
  ) values (
    new.id,
    'baseline',
    1,
    'deny',
    '[]'::jsonb,
    encode(digest('[]', 'sha256'), 'hex')
  )
  on conflict (org_id, slug, version) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_seed_v2_baseline_policy on organizations;
create trigger organizations_seed_v2_baseline_policy
after insert on organizations
for each row execute function frege_v2_seed_baseline_policy();

create or replace function frege_v2_valid_credential_scopes(candidate text[])
returns boolean
language sql
immutable
as $$
  select
    cardinality(candidate) > 0
    and coalesce(bool_and(
      scope ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*(\.\*)?$'
    ), false)
  from unnest(candidate) as item(scope);
$$;

create table if not exists delegated_credentials (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  principal_id             uuid not null,
  delegated_by_principal_id uuid not null,
  policy_version_id        uuid not null,
  name                     text not null,
  key_prefix               text not null unique,
  key_hash                 text not null unique,
  scopes                   text[] not null,
  status                   text not null default 'active',
  not_before               timestamptz not null default now(),
  expires_at               timestamptz,
  last_used_at             timestamptz,
  revoked_at               timestamptz,
  created_at               timestamptz not null default now(),

  unique (org_id, id),

  foreign key (org_id, principal_id)
    references control_principals(org_id, id) on delete restrict,
  foreign key (org_id, delegated_by_principal_id)
    references control_principals(org_id, id) on delete restrict,
  foreign key (org_id, policy_version_id)
    references control_policy_versions(org_id, id) on delete restrict,

  constraint delegated_credentials_status_chk
    check (status in ('active', 'revoked')),
  constraint delegated_credentials_scopes_nonempty_chk
    check (frege_v2_valid_credential_scopes(scopes)),
  constraint delegated_credentials_key_prefix_chk
    check (key_prefix ~ '^[a-f0-9]{12}$'),
  constraint delegated_credentials_key_hash_chk
    check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint delegated_credentials_window_chk
    check (expires_at is null or expires_at > not_before),
  constraint delegated_credentials_revoked_at_chk
    check (
      (status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null)
    )
);

create index if not exists delegated_credentials_org_principal_idx
  on delegated_credentials (org_id, principal_id, status, created_at desc);

create index if not exists delegated_credentials_prefix_idx
  on delegated_credentials (key_prefix);

-- One server-only projection centralizes subject-liveness and tenant joins for
-- both bearer authentication and trusted persisted-FK authentication. Human
-- and agent principals fail closed if their concrete subject is absent.
create or replace view v2_credential_auth_context as
select
  organizations.id as org_id,
  organizations.slug as org_slug,
  organizations.name as org_name,
  organizations.status as org_status,
  principals.id as principal_id,
  principals.principal_type,
  principals.slug as principal_slug,
  principals.name as principal_name,
  principals.status as principal_status,
  principals.subject_user_id,
  principals.subject_agent_id,
  principals.created_by_principal_id as principal_created_by,
  principals.created_at as principal_created_at,
  principals.updated_at as principal_updated_at,
  case
    when principals.principal_type = 'human' then
      principals.subject_user_id is not null and exists (
        select 1
        from organization_memberships memberships
        join users on users.id = memberships.user_id
        where memberships.org_id = principals.org_id
          and memberships.user_id = principals.subject_user_id
          and memberships.status = 'active'
          and users.status = 'active'
      )
    when principals.principal_type = 'agent' then
      principals.subject_agent_id is not null and exists (
        select 1
        from agent_definitions agents
        where agents.org_id = principals.org_id
          and agents.id = principals.subject_agent_id
          and agents.status = 'active'
      )
    when principals.principal_type = 'service' then true
    else false
  end as subject_active,
  credentials.id as credential_id,
  credentials.name as credential_name,
  credentials.key_prefix,
  credentials.key_hash,
  credentials.scopes,
  credentials.status as credential_status,
  credentials.delegated_by_principal_id,
  credentials.not_before,
  credentials.expires_at,
  credentials.last_used_at,
  credentials.revoked_at,
  credentials.created_at as credential_created_at,
  policies.id as policy_id,
  policies.slug as policy_slug,
  policies.version as policy_version,
  policies.default_decision,
  policies.rules as policy_rules,
  policies.rules_digest,
  policies.created_by_principal_id as policy_created_by,
  policies.created_at as policy_created_at
from delegated_credentials credentials
join organizations on organizations.id = credentials.org_id
join control_principals principals
  on principals.org_id = credentials.org_id
 and principals.id = credentials.principal_id
join control_policy_versions policies
  on policies.org_id = credentials.org_id
 and policies.id = credentials.policy_version_id;

create table if not exists authorization_receipts (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  principal_id             uuid not null,
  delegated_credential_id  uuid not null,
  policy_version_id        uuid not null,
  correlation_id           uuid not null,
  request_id               text not null,
  action                   text not null,
  resource_type            text not null,
  resource_id              text,
  decision                 text not null,
  matching_rule_id         text,
  reason_code              text not null,
  created_at               timestamptz not null default now(),

  unique (org_id, id),

  foreign key (org_id, principal_id)
    references control_principals(org_id, id) on delete restrict,
  foreign key (org_id, delegated_credential_id)
    references delegated_credentials(org_id, id) on delete restrict,
  foreign key (org_id, policy_version_id)
    references control_policy_versions(org_id, id) on delete restrict,

  constraint authorization_receipts_decision_chk
    check (decision in ('allow', 'deny')),
  constraint authorization_receipts_request_id_chk
    check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  constraint authorization_receipts_action_chk
    check (action ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$'),
  constraint authorization_receipts_resource_type_chk
    check (resource_type ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$'),
  constraint authorization_receipts_resource_id_chk
    check (
      resource_id is null
      or resource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    ),
  constraint authorization_receipts_rule_shape_chk
    check (
      (decision = 'allow' and matching_rule_id is not null)
      or decision = 'deny'
    ),
  constraint authorization_receipts_matching_rule_chk
    check (matching_rule_id is null or matching_rule_id ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint authorization_receipts_reason_chk
    check (reason_code in (
      'allowed_by_policy',
      'explicit_deny',
      'default_deny',
      'tenant_mismatch',
      'principal_inactive',
      'credential_inactive',
      'credential_not_yet_valid',
      'credential_expired',
      'credential_scope_mismatch',
      'policy_invalid'
    )),
  constraint authorization_receipts_decision_reason_chk
    check (
      (decision = 'allow' and reason_code = 'allowed_by_policy')
      or (decision = 'deny' and reason_code <> 'allowed_by_policy')
    )
);

create index if not exists authorization_receipts_org_created_at_idx
  on authorization_receipts (org_id, created_at desc);

create index if not exists authorization_receipts_org_correlation_idx
  on authorization_receipts (org_id, correlation_id, created_at desc);

create index if not exists authorization_receipts_org_principal_idx
  on authorization_receipts (org_id, principal_id, created_at desc);

create table if not exists provenance_events (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  principal_id             uuid,
  delegated_credential_id  uuid,
  event_type               text not null,
  action                   text not null,
  resource_type            text,
  resource_id              text,
  outcome                  text not null,
  authorization_receipt_id uuid,
  correlation_id           uuid not null,
  payload                  jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),

  unique (org_id, id),

  foreign key (org_id, principal_id)
    references control_principals(org_id, id) on delete restrict,
  foreign key (org_id, delegated_credential_id)
    references delegated_credentials(org_id, id) on delete restrict,
  foreign key (org_id, authorization_receipt_id)
    references authorization_receipts(org_id, id) on delete restrict,

  constraint provenance_events_event_type_chk
    check (event_type ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$'),
  constraint provenance_events_action_chk
    check (action ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$'),
  constraint provenance_events_outcome_chk
    check (outcome in ('success', 'failure', 'allow', 'deny')),
  constraint provenance_events_payload_chk
    check (jsonb_typeof(payload) = 'object'),
  constraint provenance_events_resource_id_chk
    check (
      resource_id is null
      or resource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    )
);

create index if not exists provenance_events_org_created_at_idx
  on provenance_events (org_id, created_at desc);

create index if not exists provenance_events_org_correlation_idx
  on provenance_events (org_id, correlation_id, created_at desc);

create index if not exists provenance_events_org_action_idx
  on provenance_events (org_id, action, created_at desc);

-- Compatibility projection: v2-native provenance plus safe, content-free
-- projections of the existing telemetry and audit streams. Legacy metadata is
-- intentionally omitted because it predates the v2 receipt disclosure rules.
create or replace view unified_provenance_events as
select
  provenance_events.id::text as event_id,
  provenance_events.org_id,
  provenance_events.principal_id,
  control_principals.principal_type,
  provenance_events.delegated_credential_id,
  provenance_events.event_type,
  provenance_events.action,
  provenance_events.resource_type,
  provenance_events.resource_id,
  provenance_events.outcome,
  provenance_events.authorization_receipt_id,
  provenance_events.correlation_id::text,
  provenance_events.payload,
  provenance_events.created_at,
  'v2'::text as source
from provenance_events
left join control_principals
  on control_principals.org_id = provenance_events.org_id
 and control_principals.id = provenance_events.principal_id

union all

select
  'telemetry:' || telemetry_events.id::text,
  telemetry_events.org_id,
  null::uuid,
  case
    when telemetry_events.actor_type = 'user' then 'human'
    when telemetry_events.actor_type = 'api_key' then 'service'
    else null
  end,
  null::uuid,
  'legacy.telemetry',
  telemetry_events.action,
  telemetry_events.resource_type,
  telemetry_events.resource_id::text,
  case
    when telemetry_events.outcome = 'success' then 'success'
    when telemetry_events.outcome = 'denied' then 'deny'
    else 'failure'
  end,
  null::uuid,
  case
    when telemetry_events.request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      then telemetry_events.request_id
    else 'legacy-request:' || left(encode(digest(telemetry_events.request_id, 'sha256'), 'hex'), 32)
  end,
  jsonb_strip_nulls(jsonb_build_object(
    'legacy_actor_type', telemetry_events.actor_type,
    'legacy_actor_user_id', telemetry_events.actor_user_id,
    'legacy_actor_key_id', telemetry_events.actor_key_id
  )),
  telemetry_events.created_at,
  'v1_telemetry'::text
from telemetry_events
where telemetry_events.org_id is not null

union all

select
  'audit:' || audit_events.id::text,
  audit_events.org_id,
  null::uuid,
  case when audit_events.actor_key_id is null then null else 'service' end,
  null::uuid,
  'legacy.audit',
  audit_events.action,
  audit_events.resource_type,
  audit_events.resource_id::text,
  'success',
  null::uuid,
  null::text,
  jsonb_strip_nulls(jsonb_build_object(
    'legacy_actor_key_id', audit_events.actor_key_id
  )),
  audit_events.created_at,
  'v1_audit'::text
from audit_events;
