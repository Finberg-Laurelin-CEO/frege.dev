# Frege CLI Installation Guide For Agents

Read this file, then install the Frege CLI for the user. Do not ask the user to paste JSON into a browser.

## Step 1: Get The Frege API Key

Ask the user for:

```text
FREGE_BASE_URL
FREGE_API_KEY
```

For local development:

```text
FREGE_BASE_URL=http://localhost:3000
```

The API key starts with:

```text
frg_live_
```

## Step 2: Install The CLI

Local repo path:

```bash
cd /Users/Joe/frege/worktrees/feature-prototype-audit-and-admin
cd packages/frege-cli
npm link
```

Future GitHub path:

```bash
bun install -g github:laurelin-inc/frege
```

## Step 3: Connect The Token

```bash
frege connect "$FREGE_BASE_URL" --token "$FREGE_API_KEY"
frege doctor
```

`connect` stores local machine config at:

```text
~/.frege/mcp/config.json
```

Do not commit this file.

## Step 4: Register With The Agent

Use the agent's native MCP registration command. Examples:

```bash
claude mcp add frege -- /usr/local/bin/frege mcp serve
codex mcp add frege -- frege mcp serve
```

If the target client does not have a CLI installer, configure the MCP command equivalent:

```text
command: frege
args: mcp serve
```

Do not embed the API key in the client config unless the client cannot run local commands. Prefer `frege connect`, which stores the token once in the user's home directory.

## Operating Protocol

- Use Frege MCP tools for org memory.
- Never touch the Frege database directly.
- Never read private vault/source files directly unless the user explicitly asks for that separate workflow.
- Start a Frege session for substantial tasks and append important user/agent/tool events.
- Build context before answering from Frege documents or hosted brain pages.
- Use `frege_list_agents` to discover Frege-hosted agents before asking Frege to execute work.
- Use `frege_run_agent` only when the user wants Frege's hosted runtime to execute a task; read completion with `frege_get_agent_run`.
- Cite document/page slugs and source IDs when using Frege context.
- If Frege reports denied context, do not guess denied source names.
- Use memory proposal tools for changes so Frege can audit and review them.
- Customer agents should connect to the hosted Frege API. Localhost is for development and smoke testing.

## Hosted Agent Tools

The MCP server exposes these hosted-runtime tools when the connected key has `canExecuteAgents`:

```text
frege_list_agents
frege_run_agent
frege_get_agent_run
```

Hosted agent runs are asynchronous. After `frege_run_agent`, poll `frege_get_agent_run` until `status` is `succeeded`, `failed`, or `cancelled`. Do not call runtime endpoints directly; they are reserved for Frege workers and require `FREGE_RUNTIME_TOKEN`.
