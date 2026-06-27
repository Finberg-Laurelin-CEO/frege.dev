-- Permanent free/comp activation codes for approval-gated MVP signups.

create table if not exists free_activation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text,
  status text not null default 'active',
  plan text not null default 'team',
  billing_interval text not null default 'monthly',
  seats integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  revoked_by_user_id uuid references users(id) on delete set null,
  revoked_by_email text,
  revoked_at timestamptz,
  redeemed_org_id uuid references organizations(id) on delete set null,
  redeemed_by_user_id uuid references users(id) on delete set null,
  redeemed_by_email text,
  redeemed_at timestamptz,
  constraint free_activation_codes_status_chk check (status in ('active', 'revoked', 'redeemed')),
  constraint free_activation_codes_plan_chk check (plan in ('solo', 'team')),
  constraint free_activation_codes_interval_chk check (billing_interval in ('monthly', 'annual', 'permanent')),
  constraint free_activation_codes_seats_chk check (seats >= 1)
);

create index if not exists free_activation_codes_status_created_idx
  on free_activation_codes (status, created_at desc);

create index if not exists free_activation_codes_redeemed_org_idx
  on free_activation_codes (redeemed_org_id)
  where redeemed_org_id is not null;

alter table org_billing
  add column if not exists entitlement_kind text not null default 'stripe';

alter table org_billing
  add column if not exists entitlement_status text not null default 'active';

alter table org_billing
  add column if not exists comp_activation_code_id uuid references free_activation_codes(id) on delete set null;

alter table org_billing
  add column if not exists comp_activated_by_user_id uuid references users(id) on delete set null;

alter table org_billing
  add column if not exists comp_activated_at timestamptz;

alter table org_billing
  drop constraint if exists org_billing_interval_chk;

alter table org_billing
  add constraint org_billing_interval_chk
    check (billing_interval in ('monthly', 'annual', 'permanent'));

alter table org_billing
  drop constraint if exists org_billing_entitlement_kind_chk;

alter table org_billing
  add constraint org_billing_entitlement_kind_chk
    check (entitlement_kind in ('stripe', 'comp'));

alter table org_billing
  drop constraint if exists org_billing_entitlement_status_chk;

alter table org_billing
  add constraint org_billing_entitlement_status_chk
    check (entitlement_status in ('active', 'revoked'));
