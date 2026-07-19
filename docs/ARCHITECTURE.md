# Frege Architecture

Frege is a hosted control plane and governed memory layer for AI agents. Human
operators manage organizations, access, sources, and proposed changes in the
browser. Agents connect through a thin local CLI/MCP process and call the hosted
API.

```text
Human operator
  -> Frege browser console
  -> organizations, roles, sources, review, and activity

AI agent
  -> frege mcp serve
  -> scoped API key
  -> hosted Frege API
  -> permission-filtered context and memory operations
```

The CLI stores local connection configuration and translates MCP tools into
REST requests. It does not connect directly to Frege's database.

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
activity, context builds, and memory signals. Audit and telemetry records make
important reads, writes, proposals, and administrative actions reviewable.

Obvious credentials and authorization material are redacted before session
events are persisted. Clients must still avoid sending secrets as ordinary
content.

## Model and agent runtime

Model routing and hosted agent execution are beta capabilities. Frege assembles
governed context, enforces organization and trust-zone boundaries, invokes a
configured provider when authorized, and records the resulting activity.

Frege remains model- and client-independent: the memory and permission boundary
does not depend on one model vendor or one agent application.

## Deployment boundary

The source-visible repository contains the hosted product and its thin CLI, but
is not a supported self-hosting distribution. Production infrastructure,
credentials, customer data, incident records, and operator runbooks are not part
of the public documentation set.

For the supported client setup, see [`FREGE_MCP_INSTALL.md`](FREGE_MCP_INSTALL.md).
