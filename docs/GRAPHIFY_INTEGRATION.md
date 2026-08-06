# Graphify Integration

Status: accepted and implemented for the opt-in local release.

## Decision

Frege integrates Graphify as a local, customer-run code graph. The
`@frege-dev/cli` package gets a thin adapter that invokes the pinned compatible
Graphify fork and validates its deterministic v1 export. An opt-in MCP tool
combines that local code context with the hosted Frege context packet. Source
code and the generated graph never leave the customer machine. The hosted
product keeps its existing governed knowledge graph and gains no new tables,
no ingestion path, and no server code in the first release.

## Goals

- Give MCP-connected agents code-structure context next to governed
  organizational memory.
- Keep customer source code on the customer machine.
- Ship the smallest surface that a real project can use and evaluate.
- Preserve the existing architecture boundary: the CLI is a thin client of the
  hosted API (`docs/ARCHITECTURE.md`).

## Non-goals

- A hosted code-graph backend or server-side parsing of customer code.
- New database tables, migrations, or graph storage in the hosted product.
- Vendoring or redistributing Graphify inside `@frege-dev/cli`.
- Replacing the brain page graph or the semantic map prototype.
- Automatic upload of code-derived content to the server.

## Current overlap

Frege has no code indexing today. A repository-wide search for tree-sitter,
symbol graphs, or AST parsing finds nothing. The adjacent pieces are:

- The hosted brain graph stores wikilink edges between markdown pages
  (`db/006_hosted_brain_sessions.sql`, `lib/core/brain-links.ts:23`,
  `lib/core/brain-graph.ts`). It is a document graph, not a symbol graph.
- The semantic map prototype (`db/003_semantic_map.sql`,
  `lib/core/semantic-map.ts`) stores concept nodes over documents. Its only
  embedding providers are `none` and a deterministic hash
  (`lib/core/embeddings.ts`). It has an offline indexer script and no
  production write path.
- The GitHub connector draft ingests markdown only, with hard file caps, and
  is deferred (`lib/core/github-connector-contract.ts:48`,
  `docs/GITHUB_CONNECTOR_BETA.md`).
- `frege docs push` walks local markdown and uploads it as governed documents
  (`packages/frege-cli/bin/frege-mcp.mjs:547`).

Graphify therefore adds a capability Frege lacks. It does not duplicate an
existing one.

Draft PR #16 owns the next CLI package-version change. This integration does
not bump the package version and avoids its live-run dispatcher, billing, and
bridge files.

## Zero-code baseline

One useful path already works with no new code. A customer can run
`graphify export wiki` and then `frege docs push` on the generated
`graphify-out/wiki/` markdown. The wiki then enters the normal governed
document flow, with review and provenance. This path uploads code-derived
markdown to the server, so it is a deliberate customer action, not a default.
It does not replace local query: the wiki is a snapshot, and a full wiki costs
far more tokens than a scoped subgraph query. The adapter below exists for the
scoped, private, always-current case.

## Boundary and data flow

```text
customer machine
  graphify extract/update        -> graphify-out/graph.json  (local only)
  graphify export frege          -> frege-code-graph.v1.json (privacy gate)
  frege code query "question"    -> validates v1, then runs graphify query
  agent via MCP
    frege_code_graph_query       -> local graphify, no network
    frege_code_context           -> local graphify
                                  + POST /api/v1/context/build (query text only)
hosted Frege
  receives only the query string and existing API traffic
  stores nothing new
```

The adapter spawns `graphify` with an argument array, never through a shell,
and with a minimal child environment: executable resolution, home/temp,
platform and locale essentials, and the adapter-owned Graphify settings.
`FREGE_API_KEY` and other application secrets never reach the child process.
It accepts only project-contained `graphify-out/` paths, caps process time and
output, caps graph and artifact sizes, and strictly validates schema
`frege.graphify.code-graph` version 1 before every query. The v1 artifact is the
compatibility and privacy gate; Graphify's own local query engine still queries
its full local graph so Frege does not duplicate graph search.

## Threat and privacy model

- Source code, `graph.json`, and all export artifacts stay local. The first
  release adds no request that carries file content.
- The combined context tool sends the query string to the hosted API. A query
  string can contain code identifiers. The tool is opt-in behind a flag, and
  its description states this property.
- The documented extraction mode is `graphify extract --code-only`, which runs
  offline with no API key. LLM-backed extraction is a customer choice with
  customer credentials and is out of scope for Frege support.
- The Frege adapter adds no telemetry. Graphify's query log is off by default
  and local (upstream `README.md`, `querylog.py:16`).
- Agents can still write session events or memory proposals about code through
  existing tools. The existing review flow and secret redaction
  (`lib/core/brain.ts:183`) govern those writes. Nothing becomes automatic.
- The Graphify adapter adds no server code, so it adds no hosted attack
  surface. The separate dependency-remediation commit on this branch does
  touch the hosted build: it updates Next.js and forces PostCSS and Sharp to
  patched versions (see the override note in `pnpm-workspace.yaml`). The Sharp
  override to 0.35.0 sits outside Next 15.5's declared `^0.34.3` range; it is
  intentionally kept because GHSA-f88m-g3jw-g9cj is high severity and patched
  only at >=0.35.0, and the production build and image path pass with it.

## Fork, upstream, and license policy

- Upstream Graphify is Apache-2.0, with pre-relicense portions also available
  under MIT. There is no copyleft in required dependencies.
- Frege does not redistribute Graphify. Customers install the compatible fork
  themselves. `THIRD_PARTY_NOTICES.md` nevertheless records conservative
  attribution, the upstream baseline, licenses, fork URL, and modification.
- The accepted fork is
  `https://github.com/Finberg-Laurelin-CEO/graphify-frege`, branch
  `Finberg-Laurelin-CEO/frege-export-contract`, commit
  `46101385b218847cef904ce52ecc4dad209b9f83`. It is based on upstream v8 commit
  `07b9143d4b90b1e1cb88dc71423f742a501efd29` (`0.9.34`) and adds only the
  `graphify export frege` adapter, its v1 schema, tests, and documentation.
- The fork preserves upstream `LICENSE`, `LICENSE-MIT`, and `NOTICE`. Modified
  upstream files carry a dated Frege modification notice; Frege-owned additions
  identify themselves directly.
- Do not use the Graphify name in product branding. Use it only to describe
  origin.

## Proposed user surface

CLI commands, added to the dispatch table in
`packages/frege-cli/bin/frege-mcp.mjs`:

- `frege code doctor` verifies the binary version, project-contained raw graph,
  and strict v1 export, with pinned-fork install guidance when not.
- `frege code index [PATH]` runs `graphify extract PATH --code-only`, or
  `graphify update PATH` when a graph already exists, then runs
  `graphify export frege`.
- `frege code query "QUESTION" [--budget N]` validates v1, runs Graphify's
  query engine with a bounded budget, and prints its bounded text output.

All other Graphify commands stay available through `graphify` directly. The
adapter does not wrap them.

MCP tools, registered only when the rollout flag is set, following the
existing `FREGE_SKILLS_COMPILER` pattern (`frege-mcp.mjs:59`):

- `frege_code_graph_query` with input `{ query, budget? }`. Runs
  `graphify query` locally and returns its text. It makes no network request.
- `frege_code_context` with input `{ query, limit?, budget? }`. The optional
  `budget` bounds only the local query and is never sent hosted. Calls the local query
  and `POST /api/v1/context/build`, then returns one text response with a
  `## Hosted context` section and a `## Local code graph` section. The client
  assembles the combination. The server never receives the local section.

## Version and compatibility behavior

- Minimum supported Graphify version: 0.9.34.
- The machine contract is `graphify-out/frege-code-graph.v1.json`, schema
  `frege.graphify.code-graph`, version 1. The fork accepts `links` and legacy
  `edges` in its source graph and emits deterministic `nodes` and `edges`.
- The adapter strictly validates the v1 artifact and does not parse Graphify's
  human-readable query output into a second graph model.
- The package version is intentionally unchanged while draft PR #16 is pending.

## Rollout flag

`FREGE_CODE_GRAPH=true` in the CLI environment enables the `frege code`
commands and registers the two MCP tools. Without the flag, the tools do not
appear in `tools/list` and the commands print a one-line "not enabled"
message. There is no server-side flag because there is no server-side change.

## Telemetry stance

The adapter adds no telemetry. Local Graphify collects none. The hosted
server observes only its existing traffic: the combined tool's context build
appears in the current `context_builds` telemetry like any other build.

## Failure and rollback behavior

- Missing `graphify` binary: tools return a short error text with the doctor
  hint. Every other CLI and MCP function is unaffected.
- Missing, malformed, incompatible, path-unsafe, or oversized graph/export:
  the local section reports a redacted actionable error. The hosted context
  path is unaffected.
- Combined tool with one side failing: return the healthy section plus a
  one-line note about the failed section. Never fail the whole call because
  one side failed.
- Rollback: unset `FREGE_CODE_GRAPH`. There is no stored state, no migration,
  and no server behavior to revert.

## Tests and acceptance criteria

Tests live in `packages/frege-cli/test/` with a stub `graphify` executable on
`PATH` and a small fixture `graph.json`. That directory is wired into the root
`pnpm test` glob, which CI runs.

Acceptance criteria for the first release:

1. With the flag unset, `tools/list` shows no code-graph tool and behavior is
   byte-identical to the prior release.
2. With the flag set and no `graphify` binary, `frege code doctor` exits 1
   with install guidance, and the MCP tools return the guidance as text.
3. With the fixture graph and v1 export, `frege code query` and
   `frege_code_graph_query` return deterministic bounded stub subgraph text.
4. `frege_code_context` returns both labeled sections, and a request-capture
   test proves no outbound request body contains fixture graph content.
5. The adapter never invokes a shell. A metacharacter test asserts argv remains
   a single argument and cannot create a file.
6. `pnpm typecheck`, `pnpm test`, `pnpm test:public-claims`, and
   `pnpm test:public-repository` pass.

## Phased roadmap

- Phase 0: this decision record. Done.
- Phase 1: CLI adapter, flag-gated MCP tools, and package tests wired into CI.
  Package versioning remains with draft PR #16. Exit test: the acceptance
  criteria above.
- Phase 2: run the adapter against this repository and one external project.
  Decide defaults, budget limits, and whether `frege_code_context` merges
  into `frege_build_context` as a parameter. Update
  `docs/FREGE_MCP_INSTALL.md` when the flag becomes default-on.
- Phase 3, only with usage evidence: consider governed upload of exported
  wiki summaries through the existing document pipeline. Promotion requires a
  named customer need that local query cannot meet.

## Deferred items

Deferred until evidence proves a need, with the reason stated:

- Server ingestion of `graph.json` and any new graph tables. No current
  feature reads them, and ingestion would move customer code structure onto
  the server.
- Hosted code-graph query endpoints. Same reason.
- Automatic wiki push or GitHub-connector sync of Graphify output. The
  connector itself is deferred.
- Embedding-based code search. The semantic map has no real embedding
  provider today.
- Vendoring Graphify or shipping it as a CLI dependency. Installation stays a
  customer action, which also keeps license obligations from attaching.
- Structured (JSON) query output in the adapter. Upstream `query` has no JSON
  mode. Propose it upstream if Phase 2 shows a need.

## Appendix: repository audit findings

A whole-repository audit for over-engineering and dead code ran alongside
this decision. Findings are evidence-backed only. Line numbers reference the
audit date.

### Blocking

- Two complete social sign-in stacks serve the same login and signup UI:
  hand-rolled OAuth (`lib/core/oauth-core.ts`, 594 lines, plus routes and
  `scripts/prototype/test-oauth.mjs`) and a Clerk bridge
  (`lib/core/clerk-auth.ts`, `lib/core/clerk-client.ts`,
  `app/signup/SignupSso.tsx`, `test-clerk-auth.mjs`, the `@clerk/backend`
  dependency). `app/login/LoginPanel.tsx:8` imports both. Every auth change
  is reasoned through twice and two large test suites must stay green. Pick
  the stack that production uses and delete the other, an estimated 1,200 to
  1,500 lines [estimate].
- The legacy v1 public site survives behind `FREGE_PUBLIC_SITE_V2` ternaries
  in 10 files, including `LegacyHome()` at `app/page.tsx:61-196`. If
  production runs the flag as `true`, every public-page edit maintains two
  skins for no reader. Confirm the production value, then delete the false
  branches, an estimated 350 to 500 lines [estimate], and prune
  `public/styles.css` afterward.

### Quick wins

- `lib/core/embeddings.ts` (64 lines) has zero importers. The indexer script
  duplicates its hash logic inline. Delete it.
- `public/nav.js` (154 lines) is referenced nowhere. Delete it.
- `scripts/migrate.mjs` (39 lines) is a superseded one-off runner.
  `pnpm db:migrate` replaces it. Delete it.
- Four exported functions have no caller: `listDocumentRevisions`
  (`lib/core/documents.ts`), `requireManageOrg` (`lib/core/org-guard.ts:87`),
  `revokeAllUserSessions` (`lib/core/session.ts`), `assertRequiredServerEnv`
  (`lib/core/env-check.ts`). Delete them.
- Dead types `PrototypeRoleSeed` and `PrototypeDocumentSeed`
  (`lib/core/types.ts:242`) have no importer. Delete them.
- `appBaseUrl()` in `lib/core/billing.ts:63` re-implements the fallback chain
  that `lib/core/public-url.ts:12` owns. Replace the body with a call.
- Two hand-rolled `AbortController` timeout patterns (`lib/core/http.ts:45`,
  `lib/hermes-webhook.ts:38`) can use native `AbortSignal.timeout(ms)`.
- Completed: `packages/frege-cli/test/*.test.mjs` (including
  `run-bridge.test.mjs`) is now in the root `pnpm test` glob and runs in CI.

### Deferred audit items

- Three parallel staff-authentication mechanisms on the admin deploy (Auth0,
  Vercel SSO in `lib/core/admin-sso.ts`, staff keys in
  `lib/core/platform-staff-keys.ts`). Consolidation drops an estimated 300
  lines [estimate] and the Auth0 dependency, but which mechanism production
  relies on is an operations decision.
- Orphaned operational scripts (`backfill-lead-scores.mjs`,
  `inspect-neural-map.mjs`, `replay-cron.mjs`, `run-product-proof.mjs`) have
  no references. Confirm with the owner before deletion.
- The `FREGE_V2_PREVIEW_ENABLED` surface (15 v2 routes, `lib/v2/`, the GitHub
  connector stack, about 7,000 lines [estimate]) is a deliberate technical
  preview, not a cut. It deserves a ship-or-remove date.

Estimated total across the audit: about 2,500 removable lines and up to two
dependencies [estimate].
