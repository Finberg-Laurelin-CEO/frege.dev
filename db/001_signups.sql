-- Frege signups — MVP early-access table.
-- Columns mirror lib/signup-schema.ts (visible fields) plus server-captured
-- metadata. Run once against the Neon database after DATABASE_URL is wired.

create table if not exists signups (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),

  -- server-captured metadata (no raw IP is ever stored)
  ip_hash                text,
  user_agent             text,

  -- visible form fields
  name                   text    not null,
  work_email             text    not null,
  company                text    not null,
  role                   text    not null,
  company_size           text    not null,
  expected_users         integer not null,
  current_agent_tools    text[]  not null,
  other_tool             text    not null default '',
  monthly_ai_spend       text    not null,
  willing_to_pay         text    not null,
  decision_timeline      text    not null,
  main_pain_point        text    not null,
  other_comments         text    not null default '',
  permission_to_contact  boolean not null
);

-- One signup per email (case-insensitive). Enforces dedupe at the DB layer;
-- the API maps the resulting unique violation (23505) to HTTP 409.
create unique index if not exists signups_email_lower_idx
  on signups (lower(work_email));
