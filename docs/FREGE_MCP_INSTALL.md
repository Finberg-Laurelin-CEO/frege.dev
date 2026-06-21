# Frege MCP Install

Frege MCP should be installed by the user's agent or shell, not configured by copying JSON out of the browser.

## Current Local Path

```bash
cd /Users/Joe/frege/worktrees/feature-prototype-audit-and-admin
cd packages/frege-cli
npm link
frege connect http://localhost:3000 --token frg_live_...
frege doctor
```

Then register with an MCP-aware agent:

```bash
claude mcp add frege -- /usr/local/bin/frege mcp serve
codex mcp add frege -- frege mcp serve
```

The command `frege connect` writes local machine config:

```text
~/.frege/mcp/config.json
```

`frege mcp serve` reads that config. `FREGE_BASE_URL` and `FREGE_API_KEY` env vars override it when present.

## Dummy Data Smoke Corpus

Local prototype smoke tests use synthetic markdown under:

```text
demo-data/frege-demo-docs
```

Import and index it with:

```bash
node --env-file=.env.local scripts/prototype/import-markdown-dir.mjs frege-local demo-data/frege-demo-docs/green internal published
node --env-file=.env.local scripts/prototype/import-markdown-dir.mjs frege-local demo-data/frege-demo-docs/red restricted published
node --env-file=.env.local scripts/prototype/index-semantic-map.mjs frege-local
```

Restricted imports are mapped to `trust_zone=red`; public/internal imports are mapped to `trust_zone=green`.

## Future GitHub Path

After Frege is pushed to GitHub, the intended install shape is:

```bash
npm install -g github:Finberg-Laurelin-CEO/frege.dev
frege connect https://frege.dev --token frg_live_...
frege doctor
```

For local development against the worktree dev server:

```bash
npm install -g github:Finberg-Laurelin-CEO/frege.dev
frege connect http://localhost:3000 --token frg_live_...
frege doctor
```

Customer agents should connect to the hosted Frege API. The local URL is for development and smoke testing, not a supported self-hosted product mode.

## Hosted Agent Tools

The MCP server exposes hosted runtime tools for keys with agent execution permission:

```text
frege_list_agents
frege_run_agent
frege_get_agent_run
```

`frege_run_agent` queues asynchronous work in Frege. The separate Frege Agent Runtime claims the run, builds governed context, calls the configured model endpoint, and stores the result in the run/session ledger. Agents should use `frege_get_agent_run` to read status and results.

## Security

- Frege MCP never reads the database.
- Frege MCP only calls REST APIs with the user's API key.
- API keys are scoped by org role and owner user.
- Admins can revoke keys in Frege.
- Reads, session events, context builds, model calls, and memory proposals show in telemetry/audit.

## Agent Instructions

Read:

```text
packages/frege-cli/INSTALL_FOR_AGENTS.md
```

The agent should perform install, connect, doctor, and client registration steps directly.
