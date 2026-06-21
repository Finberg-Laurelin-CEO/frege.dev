# @frege/cli

Frege CLI and MCP thin client.

Frege CLI is agent-side glue. It never touches the database. It stores a Frege API key locally, starts a stdio MCP server when asked, and calls Frege REST APIs for every command/tool call.

## Local Development

From the Frege repo:

```bash
cd packages/frege-cli
npm link
frege connect http://localhost:3000 --token frg_live_...
frege doctor
frege mcp serve
```

`connect` writes:

```text
~/.frege/mcp/config.json
```

The config file contains the Frege base URL and API key. It is local machine state and must not be committed.

## Future GitHub Install

Once Frege is on GitHub:

```bash
bun install -g github:laurelin-inc/frege
frege connect https://frege.dev --token frg_live_...
frege doctor
```

Then wire the local MCP command into the agent:

```bash
claude mcp add frege -- /usr/local/bin/frege mcp serve
codex mcp add frege -- frege mcp serve
```

The API key remains revocable from Frege admin.
