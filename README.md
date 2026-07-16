# Frege

**Many agents. One organizational reality.**

Frege is building the operating layer for AI agents. Today, Frege gives
MCP-connected agents a governed organizational memory: scoped context, source
citations, revision history, and reviewable updates without tying company
knowledge to one model or agent client.

[Website](https://frege.dev) · [Documentation](https://frege.dev/docs) ·
[Roadmap](https://frege.dev/roadmap) · [Support](SUPPORT.md) ·
[Security](SECURITY.md)

> [!IMPORTANT]
> This is a source-visible proprietary product repository, not an open-source
> project or a supported self-hosting distribution. See [License](LICENSE.md).

## Product status

Frege separates what the product does today from the broader operating-system
roadmap.

### Available now

- Organization-scoped users, roles, API keys, and trust zones.
- Versioned brain pages and documents with source metadata and links.
- Permission-gated search, reads, and context packets over REST and MCP.
- Agent sessions and event history for durable task context.
- Memory proposals that require review before changing canonical knowledge.
- Audit and telemetry records for product activity.
- A thin local CLI/MCP client that connects Codex, Claude Code, and compatible
  stdio MCP clients to the hosted Frege API.

### Beta

- Configurable model routing and invocation.
- Hosted agent definitions, queued runs, and run-step history.

These runtime features are early and should not be treated as a general-purpose
agent orchestration platform.

### Planned

- First-class human, agent, and service principals.
- Versioned policy decisions and authorization receipts.
- Governed connectors for external knowledge systems.
- Durable tasks, workflows, and approval gates.
- Portable import and export contracts.
- A first-party Frege agent built on the same permissions as every other agent.

See the [public roadmap](https://frege.dev/roadmap) for the current sequencing.

## How it works

```text
Human administrators
  -> Frege browser console
  -> organizations, roles, keys, sources, proposals, and activity

AI agent
  -> frege mcp serve (local stdio process)
  -> scoped API key
  -> hosted Frege API
  -> organization and trust-zone gates
  -> permitted pages, documents, context, sessions, and proposals
```

The CLI is agent-side glue. It stores local connection configuration, exposes a
stdio MCP server, and calls the hosted Frege REST API. It does not connect to
the Frege database.

Canonical knowledge is separate from task history. Agents can append events to
a session while they work, but durable knowledge changes go through memory
proposals and human review. Context responses include only resources allowed by
the caller's organization, role, capabilities, labels, and trust zone.

## Connect an agent

Requirements:

- Node.js 20 or newer.
- An active Frege organization.
- A valid Frege API key beginning with `frg_live_`.

Install the published client:

```bash
npm install -g @frege-dev/cli
```

Connect it to the hosted API and verify access:

```bash
frege connect https://frege.dev --token <valid-frg_live_key>
frege doctor
```

`frege connect` verifies the key, saves configuration at
`~/.frege/mcp/config.json`, and attempts to register `frege mcp serve` with an
installed Codex or Claude Code client. Restart an already-running MCP client,
then call `frege_status` from that client.

For a generic stdio MCP client:

```json
{
  "mcpServers": {
    "frege": {
      "command": "frege",
      "args": ["mcp", "serve"]
    }
  }
}
```

Prefer `frege connect` to placing an API key in MCP JSON. Never commit
`~/.frege/mcp/config.json`, print the full key in logs, or include it in support
requests.

The complete setup and troubleshooting guide is in
[`packages/frege-cli/README.md`](packages/frege-cli/README.md).

## Repository map

- `app/` — public pages, authenticated consoles, and REST route handlers.
- `lib/core/` — tenancy, memory, context, proposals, runtime, and telemetry
  services.
- `packages/frege-cli/` — the published CLI and local MCP server.
- `db/` — ordered PostgreSQL migrations.
- `scripts/prototype/` — maintainer checks, smoke tests, and operational tools.

This repository is the source for the hosted Frege product. Production use
requires Frege-managed infrastructure and configuration that are not supplied
as a public self-hosting bundle.

## Maintainer verification

With the required private environment configured, maintainers use:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

For CLI-only development:

```bash
cd packages/frege-cli
npm link
frege help
```

## Support and security

For product help, billing, or account questions, follow
[`SUPPORT.md`](SUPPORT.md). Do not post customer data, API keys, credentials, or
security vulnerabilities in a public issue.

Report suspected vulnerabilities privately using the process in
[`SECURITY.md`](SECURITY.md).

## License

Copyright © 2026 Frege. All rights reserved.

The code and documentation in this repository are source-visible proprietary
materials and are not offered under an open-source license. See
[`LICENSE.md`](LICENSE.md) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
