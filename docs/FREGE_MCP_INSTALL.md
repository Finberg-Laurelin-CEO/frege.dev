# Frege MCP Install

Frege MCP is installed from the agent machine or the user's shell. Do not configure it by copying API keys into browser-generated JSON. Install the CLI, connect once, then register `frege mcp serve` with the MCP client.

## Requirements

- macOS or Linux
- zsh, bash, or another POSIX-style shell
- Node.js 20 or newer
- npm
- A Frege API key that starts with `frg_live_`

Check your runtime:

```bash
node --version
npm --version
```

If Node is older than 20, install a newer Node first, then reinstall Frege.

## Install the CLI

The target public package is `@frege/cli`:

```bash
npm install -g @frege/cli
```

Until `@frege/cli` is public, install directly from GitHub with npm:

```bash
npm install -g github:Finberg-Laurelin-CEO/frege.dev
```

Verify the terminal can run Frege:

```bash
command -v frege
frege --help
```

## zsh setup for direct `frege` calls

If zsh reports `frege: command not found`, add npm's global bin directory to your zsh `PATH`.

```bash
npm config get prefix

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
hash -r

command -v frege
frege --help
```

Some npm versions support `npm bin -g`. If yours does, it should point at the same global bin directory.

If a GUI MCP client still cannot find `frege`, use the full path from `command -v frege` in that client's MCP config, or launch the client from a terminal after `source ~/.zshrc`.

## Connect Frege

Get an API key from the Frege control plane:

1. Open `https://frege.dev/login?next=/admin`.
2. Choose the org.
3. Create or select an agent role.
4. Create an API key for that role and owner.
5. Copy the raw key immediately. Frege shows it once.

Connect the CLI:

```bash
frege connect https://frege.dev --token frg_live_...
frege doctor
```

Expected `frege doctor` output includes the connected org, role, and key prefix.

For local development against a running Next dev server:

```bash
frege connect http://localhost:3000 --token frg_live_...
frege doctor
```

Customer agents should connect to the hosted Frege API. Localhost is for development and smoke testing, not a supported self-hosted product mode.

`frege connect` writes local machine config to:

```text
~/.frege/mcp/config.json
```

`frege mcp serve` reads that config. `FREGE_BASE_URL` and `FREGE_API_KEY` environment variables override it when present.

## Register with MCP clients

### Claude Code

```bash
claude mcp add frege -- frege mcp serve
```

### Codex

```bash
codex mcp add frege -- frege mcp serve
```

### Generic MCP JSON

Use this shape when the client expects JSON configuration:

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

Do not put the API key in MCP JSON unless the client cannot run local commands. Prefer `frege connect`, which stores the token once in the user's home directory.

## Local repo development

From a cloned Frege repo:

```bash
cd /path/to/frege.dev/packages/frege-cli
npm link
frege connect http://localhost:3000 --token frg_live_...
frege doctor
frege mcp serve
```

## Common CLI commands

```bash
frege status
frege search "refund policy"
frege context "customer escalation steps"
frege mcp serve
frege agent install claude
frege agent install codex
```

## Hosted agent tools

The MCP server exposes hosted runtime tools for keys with agent execution permission:

```text
frege_list_agents
frege_run_agent
frege_get_agent_run
```

`frege_run_agent` queues asynchronous work in Frege. The separate Frege Agent Runtime claims the run, builds governed context, calls the configured model endpoint, and stores the result in the run/session ledger. Agents should use `frege_get_agent_run` to read status and results.

## Troubleshooting

### `frege: command not found`

```bash
npm install -g @frege/cli
# or, until public npm publishing is complete:
npm install -g github:Finberg-Laurelin-CEO/frege.dev

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
command -v frege
```

### Node version error

```bash
node --version
```

Frege requires Node.js 20 or newer.

### `frege doctor` says the API key is missing

```bash
frege connect https://frege.dev --token frg_live_...
frege doctor
```

### Wrong org or role

Create a new API key in the Frege admin console with the correct role, then reconnect:

```bash
frege connect https://frege.dev --token frg_live_...
frege doctor
```

### MCP client cannot find `frege`

Use the absolute path returned by:

```bash
command -v frege
```

Then configure that path as the MCP command, keeping `args` as `["mcp", "serve"]`.

## Security

- Frege MCP never reads the database.
- Frege MCP only calls REST APIs with the user's API key.
- API keys are scoped by org role and owner user.
- Admins can revoke keys in Frege.
- Reads, session events, context builds, model calls, and memory proposals show in telemetry/audit.
- `~/.frege/mcp/config.json` is local secret state. Do not commit it.
- Rotate the API key if it appears in logs, shell history, screenshots, chat, or a committed file.
- Prefer `frege connect` over storing `FREGE_API_KEY` directly in MCP client JSON.

## Install channel guidance

Use npm now. Add Homebrew later.

Why npm now:

- The CLI is a Node executable.
- The package already exposes `frege` and `frege-mcp` binaries.
- Pilot users can install and update quickly.

```bash
npm install -g @frege/cli
npm update -g @frege/cli
```

Until npm publishing is complete:

```bash
npm install -g github:Finberg-Laurelin-CEO/frege.dev
```

Homebrew is a good future macOS convenience once the CLI has stable releases, tarballs, checksums, and a tap:

```bash
brew tap frege-dev/tap
brew install frege
```

## Agent instructions

Read:

```text
packages/frege-cli/INSTALL_FOR_AGENTS.md
```

The agent should perform install, zsh PATH setup if needed, connect, doctor, and client registration steps directly.
