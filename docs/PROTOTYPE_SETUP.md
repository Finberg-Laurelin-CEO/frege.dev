# Frege Prototype Setup

_Last updated: 2026-06-18._

This doc covers the first product-prototype branches:

- `feature/prototype-db-core`
- `feature/prototype-api-key-auth`

They create the database foundation and API-key auth layer for Frege's usable prototype: orgs, roles, API keys, markdown documents, immutable revisions, audit events, and `/api/v1/me`.

## What this branch adds

- `db/002_prototype_core.sql`
- `lib/db.ts`
- `lib/prototype/types.ts`
- `scripts/prototype/seed-demo-org.mjs`
- `lib/prototype/keys.ts`
- `lib/prototype/auth.ts`
- `scripts/prototype/create-api-key.mjs`
- `app/api/v1/health/route.ts`
- `app/api/v1/me/route.ts`

No document API routes are exposed yet. Document APIs, semantic map, and MCP land in later branches.

## Required env

```bash
DATABASE_URL=...
FREGE_API_KEY_SALT=...
```

`FREGE_API_KEY_SALT` is server-only. Use a long random value. It is required before creating or authenticating prototype API keys.

## Apply the migration

From the repo root:

```bash
vercel env pull .env.local
node --env-file=.env.local scripts/migrate.mjs db/002_prototype_core.sql
```

`psql` is not required. The existing `scripts/migrate.mjs` runner uses `@neondatabase/serverless`.

## Seed demo data

```bash
node --env-file=.env.local scripts/prototype/seed-demo-org.mjs
```

Optional custom org:

```bash
node --env-file=.env.local scripts/prototype/seed-demo-org.mjs acme-demo "Acme Demo"
```

Default seed creates:

- org: `frege-demo`
- roles:
  - `reader` — reads `public` + `internal`
  - `writer` — reads `public` + `internal`, can create/update docs
  - `restricted-reader` — reads `public` + `internal` + `restricted`
  - `admin` — reads all labels, can write, can read audit
- documents:
  - `company-overview` (`public`)
  - `customer-refunds` (`internal`)
  - `engineering-oncall` (`internal`)
  - `sales-handoff` (`internal`)
  - `pricing-exceptions` (`restricted`)
  - `incident-escalation` (`restricted`)

The seed is idempotent. Running it again updates the demo org, roles, document metadata, and revision 1 bodies to the checked-in seed content.

## Create a prototype API key

```bash
node --env-file=.env.local scripts/prototype/create-api-key.mjs frege-demo reader "Local reader"
```

The script prints the raw key once. Store it in your shell for local testing:

```bash
export FREGE_API_KEY="frg_live_..."
```

Only `key_prefix` and `key_hash` are stored in Postgres. The raw key is never stored.

## Smoke test auth

Start the dev server:

```bash
pnpm dev
```

Then call:

```bash
curl http://localhost:3000/api/v1/health
curl -H "Authorization: Bearer $FREGE_API_KEY" http://localhost:3000/api/v1/me
```

`/api/v1/me` returns the org, role, key prefix, allowed labels, and capabilities attached to the key.

## Tables

```txt
organizations
roles
api_keys
knowledge_documents
knowledge_document_revisions
audit_events
```

Semantic-map tables are intentionally not here. They land in `db/003_semantic_map.sql` on `feature/prototype-semantic-map`.

## Next branch

After these branches land, cut:

```txt
feature/prototype-documents-read-api
```

That branch should add permission-filtered document list/read/search endpoints and audit events for successful reads/searches.
