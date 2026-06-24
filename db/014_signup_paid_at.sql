-- Track when an approved signup completes paid checkout.
alter table signups
  add column if not exists paid_at timestamptz;

create index if not exists signups_paid_at_idx
  on signups (paid_at, invited_at desc)
  where invite_id is not null;
