-- Billing, org activation, platform staff, and usage rollups.

-- Platform staff: cross-org operators (you). Per-org admin is unchanged.
alter table users
  add column if not exists is_platform_staff boolean not null default false;

create index if not exists users_platform_staff_idx
  on users (is_platform_staff)
  where is_platform_staff = true;

-- Org activation lifecycle. New orgs start inactive until paid.
alter table organizations
  add column if not exists status text not null default 'inactive';

alter table organizations
  add column if not exists activated_at timestamptz;

alter table organizations
  add column if not exists suspended_at timestamptz;

alter table organizations
  drop constraint if exists organizations_status_chk;

alter table organizations
  add constraint organizations_status_chk
    check (status in ('inactive', 'active', 'suspended'));

create index if not exists organizations_status_idx
  on organizations (status, created_at desc);

-- Billing state per org (one subscription per org for the pilot).
create table if not exists org_billing (
  org_id uuid primary key references organizations(id) on delete cascade,
  plan text not null default 'solo',
  billing_interval text not null default 'monthly',
  seats integer not null default 1,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  constraint org_billing_plan_chk check (plan in ('solo', 'team')),
  constraint org_billing_interval_chk check (billing_interval in ('monthly', 'annual')),
  constraint org_billing_seats_chk check (seats >= 1)
);

create unique index if not exists org_billing_stripe_subscription_idx
  on org_billing (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- Daily usage rollup. actor_user_id null = whole-org aggregate for the day.
create table if not exists usage_daily (
  org_id uuid not null references organizations(id) on delete cascade,
  day date not null,
  actor_user_id uuid references users(id) on delete set null,
  model_calls integer not null default 0,
  context_builds integer not null default 0,
  denied_events integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_usd numeric not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists usage_daily_unique_idx
  on usage_daily (org_id, day, coalesce(actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists usage_daily_org_day_idx
  on usage_daily (org_id, day desc);

create index if not exists usage_daily_day_idx
  on usage_daily (day desc);

-- Link an approved signup to the invite/account it provisioned.
alter table signups
  add column if not exists invited_at timestamptz;

alter table signups
  add column if not exists invite_id uuid references organization_invites(id) on delete set null;

-- Grandfather: orgs that exist at migration time predate the pay-to-activate gate.
-- Keep them active so current agents are not broken. New orgs default to 'inactive'.
update organizations
  set status = 'active', activated_at = coalesce(activated_at, now())
  where status = 'inactive';
