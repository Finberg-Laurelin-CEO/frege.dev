-- Email verification for self-serve signup.

alter table users
  add column if not exists email_verified_at timestamptz;

update users
  set email_verified_at = coalesce(email_verified_at, last_login_at, created_at)
  where email_verified_at is null;

create table if not exists email_verification_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists email_verification_tokens_user_created_idx
  on email_verification_tokens (user_id, created_at desc);

create index if not exists email_verification_tokens_pending_idx
  on email_verification_tokens (user_id, expires_at)
  where used_at is null;
