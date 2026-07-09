# Frege Prototype Setup

_Last updated: 2026-06-18._

This doc covers the first product-prototype branches:

- `feature/prototype-db-core`
- `feature/prototype-api-key-auth`
- `feature/prototype-documents-read-api`
- `feature/prototype-semantic-map`
- `feature/prototype-documents-write-api`
- `feature/prototype-audit-and-admin`

They create the database foundation, API-key auth layer, permission-filtered read/write API, semantic-map layer, and operator inspection tools for Frege's usable prototype: orgs, roles, API keys, markdown documents, immutable revisions, safe proposals, audit events, `/api/v1/me`, document list/read/search/create/update/proposal routes, chunks, concepts, explicit links, map/context routes, and audit-event queries.

## What this branch adds

- `db/002_prototype_core.sql`
- `lib/db.ts`
- `lib/core/types.ts`
- `scripts/prototype/seed-demo-org.mjs`
- `lib/core/keys.ts`
- `lib/core/auth.ts`
- `scripts/prototype/create-api-key.mjs`
- `app/api/v1/health/route.ts`
- `app/api/v1/me/route.ts`
- `lib/core/audit.ts`
- `lib/core/documents.ts`
- `app/api/v1/documents/route.ts`
- `app/api/v1/documents/search/route.ts`
- `app/api/v1/documents/[slug]/route.ts`
- `db/003_semantic_map.sql`
- `lib/core/embeddings.ts`
- `lib/core/semantic-map.ts`
- `scripts/prototype/index-semantic-map.mjs`
- `scripts/prototype/inspect-neural-map.mjs`
- `app/api/v1/map/related/route.ts`
- `app/api/v1/map/concepts/route.ts`
- `app/api/v1/map/context/route.ts`
- `app/api/v1/map/links/route.ts`
- `db/004_document_proposals.sql`
- `lib/core/document-write-schema.ts`
- `app/api/v1/documents/[slug]/proposals/route.ts`
- `app/api/v1/audit-events/route.ts`
- `scripts/prototype/create-org.mjs`
- `scripts/prototype/create-role.mjs`
- `scripts/prototype/import-markdown-dir.mjs`
- `scripts/prototype/revoke-api-key.mjs`
- `docs/PROTOTYPE_OPERATIONS.md`

MCP lands in a later branch.

## Required env

```bash
DATABASE_URL=...
FREGE_API_KEY_SALT=...
FREGE_EMBEDDING_PROVIDER=none
FREGE_EMBEDDING_MODEL=frege-keyword-index-v1
```

`FREGE_API_KEY_SALT` is server-only. Use a long random value. It is required before creating or authenticating prototype API keys.

`FREGE_EMBEDDING_PROVIDER=none` is the default. Set `FREGE_EMBEDDING_PROVIDER=hash` only when you want deterministic local prototype vectors for testing pgvector storage; no external provider is called in this branch.

## Apply the migration

From the repo root:

```bash
vercel env pull .env.local
node --env-file=.env.local scripts/migrate.mjs db/002_prototype_core.sql
node --env-file=.env.local scripts/migrate.mjs db/003_semantic_map.sql
node --env-file=.env.local scripts/migrate.mjs db/004_document_proposals.sql
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

## Smoke test document reads

With the same dev server and key:

```bash
curl -H "Authorization: Bearer $FREGE_API_KEY" http://localhost:3000/api/v1/documents
curl -H "Authorization: Bearer $FREGE_API_KEY" "http://localhost:3000/api/v1/documents/search?q=refund"
curl -H "Authorization: Bearer $FREGE_API_KEY" http://localhost:3000/api/v1/documents/customer-refunds
```

The reader role can see `public` and `internal` documents. It cannot discover or read `restricted` documents such as `pricing-exceptions`.

Successful search and read calls write `audit_events` with the actor key id, hashed client IP, user agent, and non-content metadata.

## Build and inspect the semantic map

After applying `db/003_semantic_map.sql` and seeding demo docs:

```bash
node --env-file=.env.local scripts/prototype/index-semantic-map.mjs frege-demo
node --env-file=.env.local scripts/prototype/inspect-neural-map.mjs frege-demo customer-refunds
```

The index script chunks latest published markdown revisions, extracts simple concepts from titles/tags/summaries, creates generated document links, and records a `semantic_index_runs` row. Embedding columns are nullable; by default the prototype indexes explainable links/concepts without calling an external embedding provider.

## Smoke test semantic map

With the same dev server and key:

```bash
curl -H "Authorization: Bearer $FREGE_API_KEY" "http://localhost:3000/api/v1/map/related?slug=customer-refunds"
curl -H "Authorization: Bearer $FREGE_API_KEY" "http://localhost:3000/api/v1/map/context?slug=customer-refunds"
curl -H "Authorization: Bearer $FREGE_API_KEY" "http://localhost:3000/api/v1/map/concepts?q=refund"
```

Writer/admin keys can create explicit document links:

```bash
curl -X POST -H "Authorization: Bearer $FREGE_API_KEY" -H "Content-Type: application/json" \
  -d '{"source_slug":"customer-refunds","target_slug":"sales-handoff","link_type":"related","evidence":"Support and sales both touch customer handoff expectations."}' \
  http://localhost:3000/api/v1/map/links
```

Map responses apply the same sensitivity filter as document reads. A normal reader key cannot discover restricted neighbors, restricted concept-only metadata, or restricted context chunks.

## Smoke test document writes

Create a writer key first:

```bash
node --env-file=.env.local scripts/prototype/create-api-key.mjs frege-demo writer "Local writer"
export FREGE_WRITER_KEY="frg_live_..."
```

Then create a document:

```bash
curl -X POST -H "Authorization: Bearer $FREGE_WRITER_KEY" -H "Content-Type: application/json" \
  -d '{"path":"engineering/demo-write.md","title":"Demo Write","sensitivity":"internal","tags":["engineering","demo"],"body_md":"# Demo Write\n\nThis document was created through the prototype API."}' \
  http://localhost:3000/api/v1/documents
```

Append a new revision without overwriting history:

```bash
curl -X PUT -H "Authorization: Bearer $FREGE_WRITER_KEY" -H "Content-Type: application/json" \
  -d '{"summary":"Updated demo write document.","body_md":"# Demo Write\n\nThis is revision 2."}' \
  http://localhost:3000/api/v1/documents/demo-write
```

Create a safe proposal without changing the published revision:

```bash
curl -X POST -H "Authorization: Bearer $FREGE_WRITER_KEY" -H "Content-Type: application/json" \
  -d '{"summary":"Proposed wording update.","proposed_body_md":"# Demo Write\n\nThis is a proposed revision."}' \
  http://localhost:3000/api/v1/documents/demo-write/proposals
```

Writer keys cannot create or update documents with sensitivity labels outside their `allowed_labels`.

## Smoke test audit events

Create an admin key first:

```bash
node --env-file=.env.local scripts/prototype/create-api-key.mjs frege-demo admin "Local admin"
export FREGE_ADMIN_KEY="frg_live_..."
```

Then query audit events:

```bash
curl -H "Authorization: Bearer $FREGE_ADMIN_KEY" http://localhost:3000/api/v1/audit-events
curl -H "Authorization: Bearer $FREGE_ADMIN_KEY" "http://localhost:3000/api/v1/audit-events?action=documents.read&limit=25"
```

Only roles with `can_read_audit=true` can read audit events. See `docs/PROTOTYPE_OPERATIONS.md` for org/role/key/import/revoke commands.

## Tables

```txt
organizations
roles
api_keys
knowledge_documents
knowledge_document_revisions
document_revision_proposals
audit_events
knowledge_chunks
document_links
concept_nodes
concept_edges
document_concepts
semantic_index_runs
```

`db/003_semantic_map.sql` enables `pgvector` and stores nullable `vector(1536)` embeddings. The first indexer works without external embeddings so the explainable graph can be rebuilt before semantic similarity is wired to a provider.

## Next branch

After these branches land, cut:

```txt
feature/prototype-mcp-gateway
```

That branch should add the local stdio MCP adapter over the existing REST API.
