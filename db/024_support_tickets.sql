-- Support tickets: in-app customer support with SLA tracking.
-- Customers (org owners/admins) raise tickets from /support; platform staff
-- triage, reply, and resolve from the /platform console. SLA state is stored
-- as timestamps (first_response_at, resolved_at) and "due" is computed in
-- queries — no timers or background jobs.

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  subject text not null,
  status text not null default 'open'
    check (status in ('open','pending','resolved','closed')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references users(id) on delete set null,
  first_response_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  author_kind text not null check (author_kind in ('customer','staff')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_status_idx on support_tickets (status, updated_at desc);
create index if not exists support_ticket_messages_ticket_idx on support_ticket_messages (ticket_id, created_at);
