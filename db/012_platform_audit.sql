-- Cross-org audit log for platform staff actions.
-- The existing audit_events table is org-scoped; platform operators act across
-- orgs (and on non-org targets like Stripe charges), so they need their own log.

create table if not exists platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_events_created_at_idx
  on platform_audit_events (created_at desc);

create index if not exists platform_audit_events_action_idx
  on platform_audit_events (action, created_at desc);

create index if not exists platform_audit_events_target_idx
  on platform_audit_events (target_type, target_id);
