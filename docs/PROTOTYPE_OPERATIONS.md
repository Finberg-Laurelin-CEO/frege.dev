# Frege Prototype Operations

_Last updated: 2026-06-18._

This is the operator runbook for the API-key-first prototype. It assumes the stacked prototype branches through `feature/prototype-audit-and-admin` are deployed or running locally.

## Apply migrations

```bash
vercel env pull .env.local
node --env-file=.env.local scripts/migrate.mjs db/002_prototype_core.sql
node --env-file=.env.local scripts/migrate.mjs db/003_semantic_map.sql
node --env-file=.env.local scripts/migrate.mjs db/004_document_proposals.sql
```

## Create an org and roles

```bash
node --env-file=.env.local scripts/prototype/create-org.mjs acme-demo "Acme Demo"

node --env-file=.env.local scripts/prototype/create-role.mjs acme-demo reader "Reader" public,internal false false false
node --env-file=.env.local scripts/prototype/create-role.mjs acme-demo writer "Writer" public,internal true true false
node --env-file=.env.local scripts/prototype/create-role.mjs acme-demo admin "Admin" public,internal,restricted true true true
```

Role booleans are:

```txt
can_create_docs can_update_docs can_read_audit
```

## Create API keys

```bash
node --env-file=.env.local scripts/prototype/create-api-key.mjs acme-demo reader "Acme reader"
node --env-file=.env.local scripts/prototype/create-api-key.mjs acme-demo writer "Acme writer"
node --env-file=.env.local scripts/prototype/create-api-key.mjs acme-demo admin "Acme admin"
```

The raw key is printed once. Store it in the pilot agent config or local shell.

## Revoke API keys

```bash
node --env-file=.env.local scripts/prototype/revoke-api-key.mjs <key-prefix>
```

Revocation sets `api_keys.status = 'revoked'`. Future API requests with that key fail during auth.

## Import markdown

```bash
node --env-file=.env.local scripts/prototype/import-markdown-dir.mjs acme-demo ./docs internal published
```

Arguments:

```txt
<org-slug> <markdown-dir> [sensitivity] [status]
```

The importer:

- walks the directory recursively
- imports `.md` files only
- derives slugs from relative file paths
- uses the first `# Heading` as title when present
- updates existing document metadata on re-import
- appends a new immutable revision on each import

## Build semantic map

```bash
node --env-file=.env.local scripts/prototype/index-semantic-map.mjs acme-demo
node --env-file=.env.local scripts/prototype/inspect-neural-map.mjs acme-demo customer-refunds
```

The map can be rebuilt from markdown revisions and explicit/generated links.

## Read audit events

Create or use an admin/read-audit key, then:

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" http://localhost:3000/api/v1/audit-events
curl -H "Authorization: Bearer $ADMIN_KEY" "http://localhost:3000/api/v1/audit-events?action=documents.read&limit=25"
curl -H "Authorization: Bearer $ADMIN_KEY" "http://localhost:3000/api/v1/audit-events?resource_type=knowledge_document"
```

Only roles with `can_read_audit=true` can read audit events. Non-admin keys receive `403`.

Successful audit reads write an `audit_events.list` event so audit inspection is itself accountable.

## Useful local smoke checks

```bash
pnpm dev
curl http://localhost:3000/api/v1/health
curl -H "Authorization: Bearer $READER_KEY" http://localhost:3000/api/v1/me
curl -H "Authorization: Bearer $READER_KEY" http://localhost:3000/api/v1/documents
curl -H "Authorization: Bearer $ADMIN_KEY" http://localhost:3000/api/v1/audit-events
```

## Safety rules

- Never store raw API keys in the database or repo.
- Prefer writer keys for agents that need to propose/edit knowledge.
- Use admin keys only for operator inspection.
- Revoke pilot keys immediately when a test ends or a key may have leaked.
- Re-run semantic indexing after bulk imports or major document updates.
