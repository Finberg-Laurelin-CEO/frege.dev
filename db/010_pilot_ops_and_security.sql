-- Pilot operations and auth hardening.

create table if not exists auth_rate_limits (
  bucket_key text primary key,
  action text not null,
  attempts integer not null default 0,
  window_start timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auth_rate_limits_action_updated_idx
  on auth_rate_limits (action, updated_at desc);

alter table signups
  add column if not exists status text not null default 'new';

alter table signups
  add column if not exists owner_user_id uuid references users(id) on delete set null;

alter table signups
  add column if not exists contacted_at timestamptz;

alter table signups
  add column if not exists qualified_at timestamptz;

alter table signups
  add column if not exists notes text not null default '';

alter table signups
  add column if not exists disqualified_reason text not null default '';

alter table signups
  drop constraint if exists signups_status_chk;

alter table signups
  add constraint signups_status_chk
    check (status in ('new', 'contacted', 'qualified', 'disqualified'));

create index if not exists signups_status_created_at_idx
  on signups (status, created_at desc);

create index if not exists signups_owner_created_at_idx
  on signups (owner_user_id, created_at desc);
