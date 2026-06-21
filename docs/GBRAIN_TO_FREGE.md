# GBrain Patterns To Carry Into Frege

Frege should borrow the useful shape of GBrain without reading or copying a user's private `.gbrain` data store by default.

## What To Copy

GBrain's strongest architectural pattern is the provider-neutral brain boundary:

```text
status
listSources
addSource
search
getPage
writePage
sync
```

For Frege, that maps cleanly to:

```text
status          -> hosted brain counts, org, actor, capability, trust-zone readiness
listSources     -> hosted org brain sources and import roots
addSource       -> proposed source/import root, approval-gated
search          -> permissioned hosted brain page/document/session search
getPage         -> permissioned hosted markdown brain page read
writePage       -> memory proposal for page create/update, approval-gated
sync            -> future hosted import/index/reconcile job, approval-gated
```

The key lesson is not the exact implementation. It is the contract: agents talk to a brain adapter, and the adapter decides what is real, synthetic, indexed, writable, or approval-gated.

## What Frege Must Add

GBrain is personal-brain shaped. Frege is org-control-plane shaped, so the copied pattern needs these additions:

- org tenancy on every operation
- user sessions, per-user API keys, and API-key actors
- role and trust-zone gates before context leaves Frege
- telemetry for each read, search, session event, context build, proposal, sync, and model call
- a durable session ledger for raw-ish task context, with hard secret redaction
- hosted markdown brain pages, revisions, sources, and links in Postgres
- model routing rules for green/red context
- admin review of keys, sources, pages, sessions, proposals, model configs, audit, and telemetry

## Safety Rules

- Do not index real folders automatically.
- Do not initialise or read a user's private `.gbrain` store by default.
- Do not copy personal Obsidian/GBrain contents into Frege.
- Treat source onboarding as a proposal until an admin approves it.
- Keep agent writes as proposals unless the org role explicitly allows direct writes.
- If upstream GBrain source is copied directly, preserve its MIT license notice.

## Implemented Track

1. Current Frege REST APIs remain the authority.
2. Hosted brain/session/proposal service layer lives behind those APIs.
3. MCP wrapper exposes GBrain-shaped tools for status, sources, pages, sessions, context, proposals, and model invocation.
4. Admin console has a brain tab for sources, pages, sessions, and memory proposal review.
5. Telemetry links metrics events back to sessions, session events, context builds, and memory proposals.

This gives Frege a familiar GBrain-style developer surface while keeping Frege's core value: hosted org-gated context, model routing, durable task memory, and observability.
