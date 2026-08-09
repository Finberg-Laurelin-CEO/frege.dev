# Stateless hosted MCP

Frege includes an opt-in, modern-only MCP endpoint at `https://frege.dev/mcp`.
It implements the stateless MCP `2026-07-28` Streamable HTTP protocol with the
official TypeScript server SDK. The endpoint is disabled by default and returns
`404` unless `FREGE_STATELESS_MCP_ENABLED=true` on the public Frege deployment.
It is never served by the admin-only deployment or the `brain.frege.dev` alias.

## Security and protocol boundary

- Every POST requires an existing Frege API key in `Authorization: Bearer ...`.
  Cookies, query parameters, and request bodies are not accepted as credentials.
- API keys are reauthenticated from the database on every HTTP request and again
  by the existing REST route invoked for each tool. Revocation and role changes
  therefore take effect on the next call.
- This API-key mode is not advertised as MCP OAuth. Clients must support an
  out-of-band custom Bearer header. OAuth discovery can be added separately only
  with a conforming resource-server implementation.
- Requests must use MCP `2026-07-28`, including the required `_meta`,
  `MCP-Protocol-Version`, `Mcp-Method`, and (for `tools/call`) `Mcp-Name` values.
  Legacy `initialize` traffic is rejected; existing stdio remains available for
  older clients.
- Each POST carries exactly one JSON-RPC request. The only accepted methods are
  `server/discover`, `tools/list`, and `tools/call`; `subscriptions/listen`,
  batches, client notifications, compressed bodies, bodies larger than 1 MiB,
  cookie auth, cross-site browser requests, and unapproved Host/Origin values fail closed.
- Responses are JSON, capped at 512 KiB, marked `private, no-store`, and never
  contain `Mcp-Session-Id`. Gate-generated errors retain any already-validated
  JSON-RPC request ID. GET, DELETE, PUT, PATCH, and OPTIONS do not establish
  streams or sessions.
- Database-backed pre-auth IP limits and authenticated key-global limits are
  shared across serverless instances; rotating source IPs does not multiply one
  key's allowance. Underlying read routes remain the single audit/telemetry
  source; the MCP transport does not duplicate usage events.

The production host and origin are `frege.dev`. Vercel's exact `VERCEL_URL` is
admitted for that deployment. Additional exact hostnames require explicit
comma-separated `FREGE_MCP_ALLOWED_HOSTS`; an Origin-present request must match
one of those HTTPS hosts. Percent-encoded endpoint separators and case
variants return a hardened `404` before any cross-authority redirect. Do not add
wildcards, the admin project, or the brain alias.

## Read-only launch surface

The hosted catalog is deliberately retry-safe and contains only authorized read
operations:

- status and visible brain status;
- sources, page search/read, vault links, bounded graph traversal and paths;
- visible documents and document search/read;
- visible durable Frege task-session search/read when the key can read sessions;
- approved skill list/read when `FREGE_SKILLS_COMPILER=true`.

Audit-event listing is also omitted: the canonical audit route records each
access, so ambiguous retries are not externally idempotent and can change a
later listing.

Tool schemas reject extra properties and bound strings, arrays, graph depth, and
result counts. Graph links, relationship counts, and evidence include only
endpoints visible to the caller; only links with a null target are classified as
dangling. The tool catalog is capability-aware, but every call still performs
its normal server-side authorization.

The following side-effecting or metered tools remain available through
`frege mcp serve` over stdio but are intentionally absent from hosted MCP:

- `frege_add_source_proposal`
- `frege_write_page_proposal`
- `frege_propose_memory_from_session`
- `frege_start_session`
- `frege_append_session_event`
- `frege_build_context`
- `frege_create_document`
- `frege_propose_revision`

A stateless network transport can be retried after an ambiguous timeout. Those
tools must not be exposed remotely until Frege has a durable transactional
idempotency and billable-operation ledger keyed by organization, principal,
tool, client operation key, and canonical argument digest. JSON-RPC request IDs
and in-memory caches are not sufficient.

## Frege sessions are not MCP sessions

Transport statelessness does not remove Frege's durable task sessions. Hosted
session reads use an explicit `session_id` and authorize it on every call.
Creating sessions and appending events remain on the stdio path until durable
write idempotency is implemented. Frege never treats an MCP header as a task
session capability.

## Graphify privacy boundary

Graphify is never registered or imported by the hosted server. Its two code
tools remain opt-in and local to the stdio CLI, where the separately installed
Graphify fork receives a minimal child-process environment. The hosted endpoint
cannot access local files, spawn Graphify, upload source, persist a code graph,
or call a hosted graph backend.

## Rollout and verification

1. Deploy with the feature flag unset and confirm `/mcp` returns `404`.
2. Enable the flag on a preview/canary deployment with an exact allowed host.
3. Supply a canary key through a secure environment injector and run
   `FREGE_MCP_BASE_URL=https://<preview-host> pnpm smoke:mcp`. Optionally set
   `FREGE_MCP_CANARY_SESSION_ID` to verify one explicitly authorized session read.
4. Separately verify revoked/inactive keys, one authorized red-zone read, and a
   controlled cross-tenant denial; the generic smoke script cannot infer tenant fixtures.
5. After `pnpm build`, run `pnpm smoke:mcp:middleware`; then verify malformed
   headers/body, batching, cross-origin/host rejection, rate/result limits,
   no-store headers, and Graphify absence.
6. Verify existing stdio behavior and CLI package contents are unaffected.
7. Enable the flag on the public production project only after CI, independent
   security review, and the authenticated production canary pass.
8. To roll back on Vercel, remove or set
   `FREGE_STATELESS_MCP_ENABLED=false`, then create and promote a new public
   deployment; changing an environment value does not mutate an already-running
   deployment. Verify no-store `404` responses for public `/mcp` and `/mcp/` and
   for the brain/admin authorities. No database migration is required.
