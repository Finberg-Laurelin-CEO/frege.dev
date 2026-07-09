# Frege Local Worklog

_Last updated: 2026-07-09 (dated correction notes added; the historical entries below are unchanged)._

This worklog records the local prototype state for the Frege backend/control-plane worktree. It intentionally omits raw API keys, passwords, provider secrets, and bootstrap tokens.

System architecture summary:

```text
docs/HOSTED_BRAIN_ARCHITECTURE.md
```

The local-agent read/write model is documented in `docs/HOSTED_BRAIN_ARCHITECTURE.md` under `Local Agent Knowledge Flow`.

## Worktree

```text
/Users/Joe/frege/worktrees/feature-prototype-audit-and-admin
```

Rules followed:

- Build only in this worktree.
- Read-only vault access only; no vault writes.
- No GitHub push or deploy yet.
- Use dummy data for local agent testing.

## Current Backend Shape

- Password bootstrap/login exists under `/setup` and `/login`.
- Admin console exists under `/admin`.
- Admin APIs cover orgs, members, roles, API keys, model configs, telemetry, and audit.
- Agent APIs remain bearer-key based.
- API keys carry an owner user so agent activity can be attributed to a human inside the org.
- Org tenancy is derived from session/API-key auth, not trusted client input.
- `telemetry_events` is the event spine; `audit_events` remains compliance history.
- Hosted brain tables store sources, markdown brain pages, revisions, links, sessions, session events, and memory proposals.
- Raw-ish task context belongs in the brain/session ledger, not telemetry metadata. The ledger hard-redacts raw API keys, passwords, authorization headers, cookies, provider secrets, and tokens.
- Context builds persist selected docs/chunks, source IDs, token estimates, trust zone, and denied counts.
- Context builds can attach to an agent session and include hosted brain pages alongside prototype documents.
- Model invocation is pluggable through Frege model configs and trust-zone gates.
- Hosted agent definitions and queued agent runs are implemented. Agents are queued by API-key/user actors, executed by a separate runtime worker, and written back into the run/session ledger.
- Frege CLI/MCP is implemented at `packages/frege-cli`.
- Frege is planned as hosted SaaS for customers. Local runtime remains for development and the thin MCP/CLI client.
- The public landing page no longer links to internal prototype/admin/setup routes. `/admin` and `/prototype` are password-session protected and redirect to `/login` before rendering.
- The authenticated admin console links to `/prototype`; the public site does not.
- `/setup` is noindexed, unlinked, and redirects to `/login` after the first user exists; it only renders for initial bootstrap when `FREGE_BOOTSTRAP_TOKEN` is configured and the user table is empty.

## Local Environment

The app uses `.env.local` in this worktree. Required values:

```text
DATABASE_URL
FREGE_API_KEY_SALT
FREGE_BOOTSTRAP_TOKEN
FREGE_SECRET_KEY
FREGE_RUNTIME_TOKEN
```

`.env.local` is local-only and must not be committed.

The local Vercel project is linked to:

```text
laurelin-inc/frege-dev
```

## Migrations

The local/dev DB has the prototype migrations applied:

```bash
node --env-file=.env.local scripts/migrate.mjs db/002_prototype_core.sql
node --env-file=.env.local scripts/migrate.mjs db/003_semantic_map.sql
node --env-file=.env.local scripts/migrate.mjs db/004_document_proposals.sql
node --env-file=.env.local scripts/migrate.mjs db/005_control_plane_context_telemetry.sql
node --env-file=.env.local scripts/migrate.mjs db/006_hosted_brain_sessions.sql
node --env-file=.env.local scripts/migrate.mjs db/007_vercel_ai_gateway_provider.sql
node --env-file=.env.local scripts/migrate.mjs db/008_openai_compatible_runtime_provider.sql
node --env-file=.env.local scripts/migrate.mjs db/009_agent_runtime.sql
```

`005_control_plane_context_telemetry.sql` was applied idempotently and adds control-plane identity, sessions, trust zones, model configs, context builds, and telemetry.

`006_hosted_brain_sessions.sql` was applied idempotently and adds per-user API-key ownership, role gates for session/memory/source access, hosted brain sources/pages/revisions/links, org-visible agent sessions/events, memory proposals, context-build links to brain pages/sessions, and telemetry links to sessions/events/context/proposals.

`007_vercel_ai_gateway_provider.sql` adds `vercel-ai-gateway` as an OpenAI-compatible model routing provider. Vercel hosts orchestration, not model weights.

`008_openai_compatible_runtime_provider.sql` adds `openai-compatible` for a Frege Agent Runtime or user-hosted model router. This is the path for Frege-executed agents powered by local/open-weight models on a separate server.

`009_agent_runtime.sql` adds `roles.can_execute_agents`, `agent_definitions`, `agent_runs`, and `agent_run_steps`. It has been applied locally and reapplied successfully for idempotency.

## Bootstrap State

The first admin bootstrap has been completed locally:

```text
org: frege-local
user: joe@laurelin-inc.com
roles: reader, writer, admin
```

Bootstrap should now refuse a second first-user bootstrap.

> **Correction (2026-07-09):** the bootstrap record above is accurate history —
> `joe@laurelin-inc.com` was the first admin and remains the platform-staff
> operator account (see `docs/ADMIN_ACCESS.md`). The demo docs
> (`docs/LOOM_INVESTOR_DEMO_SCRIPT.md`, `docs/INVESTOR_DEMO_WORKFLOW.md`)
> standardize on `joe@frege.dev` as the on-screen browser identity for the
> investor Loom. Both refer to the same org, `frege-local`. Verify
> `joe@frege.dev` is an admin member of `frege-local` before recording.

## Dummy Data

Synthetic markdown lives under:

```text
demo-data/frege-demo-docs
```

Green/internal docs:

- `support-customer-refunds`
- `engineering-deploy-rollback`
- `product-context-gateway`
- `sales-pricing-exceptions`

Red/restricted doc:

- `security-red-zone-handling`

Import commands used:

```bash
node --env-file=.env.local scripts/prototype/import-markdown-dir.mjs frege-local demo-data/frege-demo-docs/green internal published
node --env-file=.env.local scripts/prototype/import-markdown-dir.mjs frege-local demo-data/frege-demo-docs/red restricted published
node --env-file=.env.local scripts/prototype/index-semantic-map.mjs frege-local
```

Index result:

```text
documents: 5
chunks: 5
document_concepts: 60
document_links: 4
```

## CLI And MCP

The CLI package is local-linked from:

```bash
cd /Users/Joe/frege/worktrees/feature-prototype-audit-and-admin/packages/frege-cli
npm link
```

The command now resolves as:

```text
/opt/homebrew/bin/frege
```

Compatibility wrappers were also installed at:

```text
/Users/Joe/.local/bin/frege
/Users/Joe/.local/bin/frege-mcp
/usr/local/bin/frege
/usr/local/bin/frege-mcp
```

Those wrappers call `/opt/homebrew/bin/node` directly. This avoids shells that either lack `/opt/homebrew/bin` on PATH or pick an old broken `/usr/local/bin/node`.

Claude Code project config for `/Users/Joe/frege` uses:

```text
command: /usr/local/bin/frege
args: mcp serve
```

Frege MCP supports both newline-delimited JSON-RPC and Content-Length framing. Claude Code uses newline-delimited JSON-RPC for local stdio MCP health checks.

Frege local config is stored at:

```text
~/.frege/mcp/config.json
```

That file contains a local API key and must not be committed. A fresh `frege-local` writer key named `Local Frege CLI MCP` was created for local MCP testing.

Useful commands:

```bash
frege doctor
frege docs --limit 10
frege search refund --limit 5
frege context refund --limit 5
frege mcp serve
```

MCP-first hosted brain tools now include:

```text
frege_brain_status
frege_list_sources
frege_search_pages
frege_get_page
frege_add_source_proposal
frege_write_page_proposal
frege_start_session
frege_append_session_event
frege_get_session
frege_search_sessions
frege_build_context
frege_propose_memory_from_session
frege_invoke_model
frege_list_agents
frege_run_agent
frege_get_agent_run
```

Agent registration commands:

```bash
claude mcp add frege -- /usr/local/bin/frege mcp serve
codex mcp add frege -- frege mcp serve
```

The MCP wrapper calls Frege REST APIs only. It does not connect to the database.

## Hosted Agent Runtime

Local test model config:

```text
slug: runtime-smoke
provider: openai-compatible
base_url: http://127.0.0.1:4199/v1
model_name: fake-smoke-model
allowed_trust_zones: green
```

Local test agent:

```text
slug: runtime-smoke-agent
trust_zone: green
default_context_query: refund
max_steps: 1
```

Runtime worker commands:

```bash
FREGE_RUNTIME_TOKEN=frege-runtime-local-smoke FREGE_BASE_URL=http://localhost:3000 pnpm run agent:worker:once
FREGE_RUNTIME_TOKEN=frege-runtime-local-smoke FREGE_BASE_URL=http://localhost:3000 pnpm run agent:worker
```

The runtime endpoints are token-guarded with `FREGE_RUNTIME_TOKEN`:

```text
POST /api/v1/runtime/agent-runs/claim
POST /api/v1/runtime/agent-runs/:id/complete
```

## Smoke Checks

Passed:

```text
node --check scripts/prototype/import-markdown-dir.mjs
node --check packages/frege-cli/bin/frege-mcp.mjs
node --check scripts/prototype/frege-mcp-server.mjs
node --check scripts/prototype/smoke-backend.mjs
pnpm run typecheck
node --env-file=.env.local scripts/migrate.mjs db/006_hosted_brain_sessions.sql
node --env-file=.env.local scripts/migrate.mjs db/006_hosted_brain_sessions.sql
pnpm run build
GET /api/v1/health -> {"ok":true,"service":"frege-prototype-api"}
frege doctor -> org frege-local, role writer
frege docs --limit 10 -> 4 green/internal docs visible
frege search refund --limit 5 -> support/pricing/rollback results
frege context refund --limit 5 -> green context packet with source chunks/links/concepts
frege context "restricted red zone" --limit 5 -> denied_count 1, no restricted body returned
MCP stdio initialize/tools/list/tools/call -> legacy status/search/context successful
MCP JSONL tools/list -> hosted brain/session/proposal tools discovered
MCP JSONL frege_brain_status -> success
MCP JSONL frege_list_agents -> returned runtime-smoke-agent
Hosted brain REST smoke -> session start, redacted event append, context build attached to session, pending memory proposal, session read
pnpm run smoke:backend -> health/auth/origin/context/redaction/proposal/MCP smoke successful
pnpm run smoke:backend:agent -> same backend smoke plus hosted agent run queue/readback successful
Context build "refund policy" -> 3 allowed green documents, 356 token estimate, denied_count 0
Agent runtime smoke -> queued runtime-smoke-agent, worker completed run ea8bae1b-71d1-43a6-8a0a-dcd81118cc14, context step recorded document_count 3 and token_estimate 356
frege wrapper smoke with /usr/local/bin-only PATH -> doctor/search/MCP startup successful
Claude Code `claude mcp list` -> frege connected
```

Build note:

```text
next build passes, but still emits the existing non-fatal dynamic font warning:
Failed to load dynamic font for ● . Status: 400
```

After `pnpm run build`, the Next dev server can hold a stale `.next` cache. Restart `pnpm dev` and re-check `/api/v1/health` before continuing local browser work.

## 2026-06-21 UI Docs And Entry Points

Added a public `/docs` page with the user-facing setup path for orgs, roles, API keys, MCP installation, and agent operating instructions. The homepage now exposes sign-in, docs, and the GitHub repo link while keeping `/admin`, `/console`, and `/prototype` protected by login.

The admin console now opens on a setup-docs tab before the operational tabs. It points users to org/role setup, per-user API-key generation, GitHub CLI install, MCP registration, hosted brain review, and the public docs page.

Updated MCP install docs to use the current GitHub remote:

```bash
npm install -g github:Finberg-Laurelin-CEO/frege.dev
frege connect https://frege.dev --token frg_live_...
frege doctor
```

> **Correction (2026-07-09):** the GitHub install channel above is dead — do not
> use it. The canonical install is the published npm package
> (`npm install -g @frege-dev/cli`); see `docs/FREGE_MCP_INSTALL.md`. Leftover
> GitHub installs cause the `EEXIST` collisions described in that doc's
> troubleshooting section and should be uninstalled.

Verification passed:

```text
pnpm run typecheck
pnpm run build
GET /docs -> 200
GET /admin -> 307 /login?next=%2Fadmin
GET /console -> 307 /login?next=%2Fconsole
GET /prototype -> 307 /login?next=%2Fprototype
Browser check -> homepage/docs no horizontal overflow, docs include API-key and GitHub install guidance
```

Known local npm note:

```text
npm link ./packages/frege-cli
```

from the repo root hit an npm internal `isDescendantOf` error. The package-local `cd packages/frege-cli && npm link` path works.

## Next Backend Work

1. Expand automated tests beyond the local smoke script: bootstrap/session auth, cross-org tenancy, API key revocation, telemetry assertions, agent queue permissions, and runtime token guards.
2. Replace the fake smoke endpoint with a real OpenAI-compatible model router or provider path for production runtime testing.
3. Deepen the admin UI for brain pages, sources, revisions, proposal review, session timelines, and agent run inspection.
4. Add a cleaner ingestion path from markdown/docs into hosted `brain_pages`, not just legacy `knowledge_documents`.
5. Tighten telemetry filters, cost summaries, denial views, model usage breakdowns, and per-key/user activity.
6. Harden security with rate limits, origin checks, secret-redaction tests, key rotation, runtime-token rotation, and session expiry checks.
7. Before production deploy, set Vercel env vars and add CI for typecheck/build/migration smoke. Creating `.github/workflows/*` requires a GitHub token with `workflow` scope.

## GitHub Direction

Do not push yet until the backend/MCP baseline is reviewed. When ready:

1. Commit this backend/MCP work on the current feature branch.
2. Push to a private Frege repo.
3. Open a backend/control-plane PR.
4. Add GitHub Actions CI after refreshing `gh` auth with `workflow` scope.
5. Create a separate frontend-only branch for aesthetic work.
6. Give Claude or another visual-design agent that frontend branch with the boundaries in `docs/CLAUDE_FRONTEND_HANDOFF.md`.
