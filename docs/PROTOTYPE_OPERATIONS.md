# Frege Prototype Operations

_Last updated: 2026-06-18._

This is the operator runbook for the API-key-first prototype. It assumes the stacked prototype branches through `feature/prototype-audit-and-admin` are deployed or running locally.

## Apply migrations

```bash
vercel env pull .env.local
node --env-file=.env.local scripts/migrate.mjs db/002_prototype_core.sql
node --env-file=.env.local scripts/migrate.mjs db/003_semantic_map.sql
node --env-file=.env.local scripts/migrate.mjs db/004_document_proposals.sql
node --env-file=.env.local scripts/migrate.mjs db/005_control_plane_context_telemetry.sql
```

`005_control_plane_context_telemetry.sql` adds user login, sessions, org memberships, model configs, context builds, trust zones, and telemetry.

## Required local env

```bash
DATABASE_URL=...
FREGE_API_KEY_SALT=...
FREGE_BOOTSTRAP_TOKEN=...
FREGE_SECRET_KEY=base64-or-long-random-secret-for-model-config-encryption
```

`FREGE_SECRET_KEY` is required only when storing provider API keys for model configs. Ollama configs can omit provider secrets.

## Vercel project env

The hosted Frege project is linked locally as:

```txt
laurelin-inc/frege-dev
```

Use the Vercel CLI to link a fresh worktree and pull the hosted database env:

```bash
vercel link --yes --scope laurelin-inc --project frege-dev
vercel env pull .env.vercel.development.local --environment=development --yes
vercel pull --environment=development --yes
```

Then merge `DATABASE_URL` from the pulled Vercel env into `.env.local` while keeping local Frege secrets. Do not commit any `.env*.local` or `.vercel` files.

When adding the Frege control-plane secrets to Vercel, set at least `development` and `production`:

```bash
vercel env add FREGE_API_KEY_SALT development --value "$FREGE_API_KEY_SALT" --yes --force
vercel env add FREGE_API_KEY_SALT production --value "$FREGE_API_KEY_SALT" --yes --force
vercel env add FREGE_BOOTSTRAP_TOKEN development --value "$FREGE_BOOTSTRAP_TOKEN" --yes --force
vercel env add FREGE_BOOTSTRAP_TOKEN production --value "$FREGE_BOOTSTRAP_TOKEN" --yes --force
vercel env add FREGE_SECRET_KEY development --value "$FREGE_SECRET_KEY" --yes --force
vercel env add FREGE_SECRET_KEY production --value "$FREGE_SECRET_KEY" --yes --force
```

Preview env is branch-scoped in non-interactive CLI mode. Add it after the branch exists in the connected Git repository.

## Bootstrap admin console

Start the app and open the setup flow:

```bash
pnpm dev
open http://localhost:3000/setup
```

Use `FREGE_BOOTSTRAP_TOKEN` to create the first admin user and org. After that:

```txt
/login  password session login
/admin  orgs, members, roles, API keys, model configs, context, telemetry, audit
```

The bootstrap endpoint refuses to create a second first user.

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
- maps `restricted` imports to `trust_zone=red` and other imports to `trust_zone=green`
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

## Context gateway

Build a governed context packet with either a user session or an API key:

```bash
curl -X POST http://localhost:3000/api/v1/context/build \
  -H "Authorization: Bearer $READER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"refund","limit":8}'
```

The response includes allowed documents/chunks, concepts, links, source IDs, `trust_zone`, token estimate, and `denied_count`. Denied summaries do not expose restricted document titles.

## Model routing

Frege does not require a local model on the server. The product default is model-agnostic routing: Frege builds governed context and routes it to the user's chosen model/provider.

When Frege executes agents itself, use a separate Frege Agent Runtime or model-router server. Configure that server as an `openai-compatible` model config with a `/v1/chat/completions` base URL. Do not run the model weights inside the Vercel app.

Create an OpenRouter free-router model config in `/admin` or through the API:

```bash
curl -X POST http://localhost:3000/api/v1/admin/model-configs \
  -H "Content-Type: application/json" \
  --cookie "frege_session=..." \
  -d '{
    "org_slug":"acme-demo",
    "slug":"openrouter-free",
    "name":"OpenRouter Free Router",
    "provider":"openrouter",
    "model_name":"openrouter/free",
    "api_key":"...",
    "allowed_trust_zones":["green"]
  }'
```

Then invoke through Frege:

```bash
curl -X POST http://localhost:3000/api/v1/model/invoke \
  -H "Authorization: Bearer $READER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model_config_slug":"openrouter-free",
    "query":"refund",
    "prompt":"Summarize the relevant policy and cite source slugs."
  }'
```

Red context is refused unless the selected model config explicitly includes `red` in `allowed_trust_zones`.

Ollama-compatible configs remain available for optional local development, but no Frege-hosted or Vercel-hosted local model is required.

For a Frege runtime/model-router server:

```json
{
  "org_slug": "acme-demo",
  "slug": "frege-runtime",
  "name": "Frege Agent Runtime Router",
  "provider": "openai-compatible",
  "base_url": "https://runtime.example.com/v1",
  "model_name": "qwen-local",
  "api_key": "...",
  "allowed_trust_zones": ["green"]
}
```

## Hosted agent runtime

Frege can queue hosted agent runs while keeping model execution outside the Vercel app. The Next backend owns org auth, context assembly, queue state, session ledger, and telemetry. A separate worker claims runs and calls the configured OpenAI-compatible model endpoint.

Required runtime environment:

```text
FREGE_RUNTIME_TOKEN
FREGE_BASE_URL
```

Optional runtime environment:

```text
FREGE_WORKER_ID
FREGE_WORKER_LIMIT
FREGE_WORKER_LEASE_SECONDS
FREGE_WORKER_INTERVAL_MS
FREGE_WORKER_ONCE
FREGE_AGENT_MAX_TOKENS
```

Local one-shot worker:

```bash
FREGE_RUNTIME_TOKEN=frege-runtime-local-smoke \
FREGE_BASE_URL=http://localhost:3000 \
pnpm run agent:worker:once
```

Production worker shape:

```bash
FREGE_RUNTIME_TOKEN="$FREGE_RUNTIME_TOKEN" \
FREGE_BASE_URL="https://frege.example.com" \
pnpm run agent:worker
```

Runtime APIs:

```text
POST /api/v1/runtime/agent-runs/claim
POST /api/v1/runtime/agent-runs/:id/complete
```

Agent-facing APIs:

```text
GET /api/v1/agents
POST /api/v1/agents
GET /api/v1/agent-runs/:id
```

Admin APIs:

```text
GET /api/v1/admin/agents
POST /api/v1/admin/agents
GET /api/v1/admin/agent-runs
```

MCP agent tools:

```text
frege_list_agents
frege_run_agent
frege_get_agent_run
```

## MCP wrapper

Frege MCP should be installed by an agent or shell, not configured from browser-copied JSON.

Current local package path:

```bash
cd /Users/Joe/frege/worktrees/feature-prototype-audit-and-admin
cd packages/frege-cli
npm link
frege connect http://localhost:3000 --token "$READER_KEY"
frege doctor
```

Then register the local MCP command with the agent:

```bash
claude mcp add frege -- frege mcp serve
codex mcp add frege -- frege mcp serve
```

The prototype compatibility entrypoint still works:

```bash
FREGE_BASE_URL=http://localhost:3000 \
FREGE_API_KEY=$READER_KEY \
node scripts/prototype/frege-mcp-server.mjs
```

The wrapper exposes tools for status/list/search/read/build-context/create/propose/audit/invoke and hosted agent runs. It calls REST APIs only. See `docs/FREGE_MCP_INSTALL.md` and `packages/frege-cli/INSTALL_FOR_AGENTS.md`.

## Useful local smoke checks

```bash
pnpm dev
pnpm run smoke:backend
pnpm run smoke:backend:agent
curl http://localhost:3000/api/v1/health
curl -H "Authorization: Bearer $READER_KEY" http://localhost:3000/api/v1/me
curl -H "Authorization: Bearer $READER_KEY" http://localhost:3000/api/v1/documents
curl -X POST -H "Authorization: Bearer $READER_KEY" -H "Content-Type: application/json" -d '{"query":"refund"}' http://localhost:3000/api/v1/context/build
curl -H "Authorization: Bearer $ADMIN_KEY" http://localhost:3000/api/v1/audit-events
frege doctor
printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"frege_list_agents","arguments":{}}}\n' | frege mcp serve
FREGE_RUNTIME_TOKEN=frege-runtime-local-smoke FREGE_BASE_URL=http://localhost:3000 pnpm run agent:worker:once
```

`pnpm run smoke:backend` reads `FREGE_BASE_URL`/`FREGE_API_KEY` or `~/.frege/mcp/config.json`. It verifies health, auth rejection, origin guard, document search, gated context, red-zone denial count, session redaction, memory proposal creation, MCP tools/list, and MCP context build.

`pnpm run smoke:backend:agent` also queues a hosted agent run if the key can execute agents and at least one active agent exists. It does not run the worker; use `pnpm run agent:worker:once` for runtime completion.

## Safety rules

- Never store raw API keys in the database or repo.
- Prefer writer keys for agents that need to propose/edit knowledge.
- Use admin keys only for operator inspection.
- Revoke pilot keys immediately when a test ends or a key may have leaked.
- Re-run semantic indexing after bulk imports or major document updates.
