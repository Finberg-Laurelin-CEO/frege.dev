-- Cross-org platform-staff API keys for agentic admin access.
-- Distinct from api_keys (which are org-scoped and carry an org role): a staff
-- key authorizes its owner as platform staff across all orgs, gated by the
-- owner still having users.is_platform_staff = true at request time.

create table if not exists platform_staff_api_keys (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  name          text not null,
  key_prefix    text not null unique,
  key_hash      text not null unique,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,

  constraint platform_staff_api_keys_status_chk
    check (status in ('active', 'revoked'))
);

create index if not exists platform_staff_api_keys_owner_idx
  on platform_staff_api_keys (owner_user_id);
