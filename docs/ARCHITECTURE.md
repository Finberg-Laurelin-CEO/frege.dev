# Frege Architecture

Frege is a hosted control plane and governed memory layer for AI agents. Human
operators manage organizations, access, sources, and proposed changes in the
browser. Agents connect either through the thin local CLI/MCP process or, for
modern retry-safe reads, an opt-in stateless hosted MCP endpoint. Both paths use
the same governed API boundary.

```text
Human operator
  -> Frege browser console
  -> organizations, roles, sources, review, and activity

AI agent
  -> frege mcp serve (stdio; reads and governed writes)
     OR /mcp (MCP 2026-07-28; opt-in read-only HTTP)
  -> scoped API key, reauthenticated per call
  -> hosted Frege API
  -> permission-filtered context and memory operations
```

The CLI stores local connection configuration and translates MCP tools into
REST requests. It does not connect directly to Frege's database. The hosted MCP
route also invokes the existing authenticated route handlers rather than adding
a second database or authorization path. Its server and actor context are
created afresh for each request.

## Identity and authorization

Every request resolves to an organization and an actor. Human sessions and
agent API keys carry roles and capabilities; callers cannot select a different
organization merely by submitting an organization identifier.

Resources have sensitivity and trust-zone metadata. Search, reads, context
building, source management, and write operations apply the caller's role and
labels before returning content.

## Durable knowledge

Frege stores versioned pages and documents with source metadata, links, and
revision history. Search and context responses retain source identity so an
agent can cite the material it used.

Canonical knowledge is distinct from task history. An agent can append events
to a session while it works, but a durable knowledge change normally becomes a
memory proposal. A human can review, accept, or reject that proposal before it
changes the canonical record.

```text
source material
  -> governed search/context packet
  -> agent session and work
  -> reviewable memory proposal
  -> accepted canonical revision
```

## Sessions and auditability

Sessions provide durable task context for user messages, agent messages, tool
activity, context builds, and memory signals. They remain explicit database
records addressed by `session_id`; they are not MCP transport sessions. Audit
and telemetry records make important reads, writes, proposals, and
administrative actions reviewable.

Obvious credentials and authorization material are redacted before session
events are persisted. Clients must still avoid sending secrets as ordinary
content.

## Agent execution boundary

The current product does not run customer agents or invoke their models. Codex,
Claude Code, and internal agents keep model credentials, tools, and compute in
the customer's environment. The local Frege CLI/MCP process calls the hosted
Frege API for governed context, sessions, proposals, review, and provenance.

This boundary keeps Frege model- and client-independent: organizational memory
and permissions do not depend on one model vendor or agent application.

## Deployment boundary

The source-visible repository contains the hosted product and its thin CLI, but
is not a supported self-hosting distribution. Production infrastructure,
credentials, customer data, incident records, and operator runbooks are not part
of the public documentation set.

For the supported client setup, see [`FREGE_MCP_INSTALL.md`](FREGE_MCP_INSTALL.md).
For the feature-flagged hosted transport and its security boundary, see
[`STATELESS_MCP.md`](STATELESS_MCP.md).
