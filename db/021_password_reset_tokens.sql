-- Password reset tokens for customer password login recovery.

create table if not exists user_password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,

  constraint user_password_reset_tokens_expiry_chk
    check (expires_at > created_at)
);

create index if not exists user_password_reset_tokens_user_created_idx
  on user_password_reset_tokens (user_id, created_at desc);

create index if not exists user_password_reset_tokens_active_idx
  on user_password_reset_tokens (token_hash, expires_at)
  where used_at is null;
