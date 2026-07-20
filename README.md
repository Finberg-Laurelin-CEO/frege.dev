# Frege

**Many agents. One organizational reality.**

[![CI](https://github.com/Finberg-Laurelin-CEO/frege.dev/actions/workflows/ci.yml/badge.svg)](https://github.com/Finberg-Laurelin-CEO/frege.dev/actions/workflows/ci.yml)

Frege is building the operating layer for AI agents. Today, Frege gives
MCP-connected agents a governed organizational memory: scoped context, source
citations, revision history, and reviewable updates without tying company
knowledge to one model or agent client.

Your agents do the work. Codex, Claude Code, and internal agents keep their own
model access and execution environment; Frege supplies the shared memory,
authorization boundary, review path, and provenance they use through MCP or the
API.

[Website](https://frege.dev) · [Documentation](https://frege.dev/docs) ·
[Repository docs](docs/README.md) ·
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
- A downloadable Frege Agent profile for Hermes that runs with the user's
  model, tools, credentials, and compute.

### Planned

- Service principals, versioned policies, authorization receipts, and unified
  provenance contracts.
- Governed connector pilots, beginning with GitHub and later Google Drive.
- Durable tasks, workflows, and approval gates.
- Portable import and export contracts.
- Optional bounded hosted execution only after customer demand and policy
  controls justify it.

Frege-hosted model and agent execution are not part of the current product.
Source-visible experimental code does not imply production availability.

See the [public roadmap](https://frege.dev/roadmap) for the current sequencing.

## How it works

```text
Human administrators
  -> Frege browser console
  -> organizations, roles, keys, sources, proposals, and activity

AI agent
  -> agent model and tools run in the customer's environment
  -> frege mcp serve (local stdio bridge)
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

Load the key into `FREGE_API_KEY` through a secure local method, then connect it
to the hosted API and verify access:

```bash
frege connect https://frege.dev --token "$FREGE_API_KEY"
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

To install the complete local Frege Agent profile on top of Hermes:

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
npm install -g @frege-dev/cli
frege connect https://frege.dev --token "$FREGE_API_KEY" --no-register
frege doctor
frege agent install hermes
frege-agent setup
frege-agent mcp test frege
frege-agent chat
```

The profile supplies Frege's context and memory workflow. Hermes, the selected
model, local tools, and all agent compute remain in the user's environment. Its
canonical source is
[`Finberg-Laurelin-CEO/frege-agent`](https://github.com/Finberg-Laurelin-CEO/frege-agent).

The complete setup and troubleshooting guide is in
[`packages/frege-cli/README.md`](packages/frege-cli/README.md).

## Repository map

- `app/` — public pages, authenticated consoles, and REST route handlers.
- `lib/core/` — tenancy, memory, context, proposals, runtime, and telemetry
  services.
- `packages/frege-cli/` — the published CLI and local MCP server.
- `packages/frege-agent-profile/` — the downloadable Hermes profile for the
  user-run Frege Agent.
- `db/` — ordered PostgreSQL migrations.
- `docs/` — curated public architecture and installation documentation.
- `scripts/prototype/` — maintainer checks, smoke tests, and operational tools.

This repository is the source for the hosted Frege product. Production use
requires Frege-managed infrastructure and configuration that are not supplied
as a public self-hosting bundle.

Internal plans, incident records, worklogs, production procedures, and investor
materials do not belong in the tracked tree. See the boundary and preservation
rules in [`docs/README.md`](docs/README.md).

## Maintainer verification

These repository checks run without production secrets:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:public-claims
pnpm test:public-repository
pnpm build
```

Live smoke tests, migrations, and production operations are intentionally not
part of the pull-request CI workflow.

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
