-- Email sign-in link (magic link) tokens for passwordless customer login.
-- Mirrors user_password_reset_tokens (db/021): single-use, sha256 token hash,
-- expiry enforced at write time (15 minutes, lib/core/login-link.ts).

create table if not exists login_link_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,

  constraint login_link_tokens_expiry_chk
    check (expires_at > created_at)
);

create index if not exists login_link_tokens_user_created_idx
  on login_link_tokens (user_id, created_at desc);

create index if not exists login_link_tokens_active_idx
  on login_link_tokens (token_hash, expires_at)
  where used_at is null;
