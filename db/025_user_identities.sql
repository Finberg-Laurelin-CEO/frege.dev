-- Customer OAuth identities (Google / GitHub) for hand-rolled sign-in.
-- A user can link multiple providers; each provider subject maps to exactly
-- one user. Rows cascade away with the user.

create table if not exists user_identities (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  provider          text not null check (provider in ('google', 'github')),
  provider_subject  text not null,
  email             text,
  created_at        timestamptz not null default now(),
  unique (provider, provider_subject)
);

create index if not exists user_identities_user_idx
  on user_identities (user_id);
