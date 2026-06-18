# Frege Prototype Setup

_Last updated: 2026-06-18._

This doc covers the first product-prototype branch: `feature/prototype-db-core`.

It creates the database foundation for Frege's usable prototype: orgs, roles, API keys, markdown documents, immutable revisions, and audit events.

## What this branch adds

- `db/002_prototype_core.sql`
- `lib/db.ts`
- `lib/prototype/types.ts`
- `scripts/prototype/seed-demo-org.mjs`

No public product API routes are exposed in this branch. Auth, document APIs, semantic map, and MCP land in later branches.

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

After this branch lands, cut:

```txt
feature/prototype-api-key-auth
```

That branch should add real key generation, key hashing, request auth context, and `GET /api/v1/me`.
