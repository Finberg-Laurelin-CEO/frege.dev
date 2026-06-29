-- Staff-issued Stripe promotion codes for limited free billing periods.

create table if not exists stripe_promo_codes (
  id uuid primary key default gen_random_uuid(),
  label text,
  recipient_email text,
  duration_months integer not null,
  percent_off numeric not null default 100,
  max_redemptions integer not null default 1,
  status text not null default 'active',
  stripe_coupon_id text not null,
  stripe_promotion_code_id text not null unique,
  code text not null,
  coupon_name text,
  expires_at timestamptz,
  times_redeemed integer not null default 0,
  created_by_user_id uuid references users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  sent_to_email text,
  sent_at timestamptz,
  email_sent boolean not null default false,
  email_error text,
  metadata jsonb not null default '{}'::jsonb,
  constraint stripe_promo_codes_status_chk check (status in ('active', 'inactive')),
  constraint stripe_promo_codes_duration_chk check (duration_months in (1, 12)),
  constraint stripe_promo_codes_percent_chk check (percent_off > 0 and percent_off <= 100),
  constraint stripe_promo_codes_redemptions_chk check (max_redemptions >= 1)
);

create index if not exists stripe_promo_codes_created_idx
  on stripe_promo_codes (created_at desc);

create index if not exists stripe_promo_codes_recipient_idx
  on stripe_promo_codes (lower(recipient_email))
  where recipient_email is not null;
