# Frege MCP Install

Frege MCP is installed from the agent machine or the user's shell. Do not configure it by copying API keys into browser-generated JSON. Install the CLI, connect once, then register `frege mcp serve` with the MCP client.

The browser app may live at `https://brain.frege.dev`, but MCP does not depend on that subdomain. The CLI only needs an API base URL that serves Frege's `/api/v1` routes. Use `https://frege.dev` as the canonical hosted API base unless Frege support gives you a different one.

## Requirements

- macOS or Linux
- zsh, bash, or another POSIX-style shell
- Node.js 20 or newer
- npm
- A Frege API key that starts with `frg_live_` before connection or MCP use

Check your runtime:

```bash
node --version
npm --version
```

If Node is older than 20, install a newer Node first, then reinstall Frege.

## Fast path

1. The user signs up, pays or enters a Frege code in Stripe, then opens the control plane.
2. An admin creates a scoped API key for an active org and role.
3. The user gives the key to a local agent through a private channel.
4. The agent installs `@frege-dev/cli`, runs `frege connect`, registers MCP, and verifies `frege_status`.

The CLI can install without an API key, but Frege is not connected until `frege connect` verifies a valid key from an active org.

## Install with an agent

Give this to the user's coding agent after the user has a valid Frege API key for an active org. The agent can install the CLI without a key, but it cannot connect, register usable MCP tools, or read Frege context until `frege connect` verifies that key.

```text
Install Frege MCP for this machine.

Inputs:
- API base: https://frege.dev
- I will provide FREGE_API_KEY separately. It starts with frg_live_.

Important:
- The browser app may open on https://brain.frege.dev. That is fine.
- MCP uses the API base above for /api/v1 calls.
- You may install the CLI without a key.
- Do not treat MCP as ready until frege connect and frege doctor both succeed.
- Do not print the full key or put it in MCP JSON, docs, screenshots, shell startup files, or chat summaries.

Steps:
1. Confirm Node.js 20+ and npm are available.
2. Run: npm install -g @frege-dev/cli
3. Verify: command -v frege && frege help
4. If npm reports EEXIST or frege is not found, use https://frege.dev/docs troubleshooting.
5. Connect with the key I provide:
   frege connect https://frege.dev --token "$FREGE_API_KEY"
6. Run: frege doctor
7. Show me only org, orgStatus, role, and key prefix.
8. If connect or doctor fails, stop and ask for a valid key from an active org.
9. Register MCP:
   frege agent install codex
   frege agent install claude
   If neither is available, configure command "frege" with args ["mcp", "serve"].
10. From the MCP client, call frege_status and confirm it matches frege doctor.
```

## Install the CLI

```bash
npm install -g @frege-dev/cli
```

Verify the terminal can run Frege:

```bash
command -v frege
frege help
```

## zsh setup for direct `frege` calls

If zsh reports `frege: command not found`, add npm's global bin directory to your zsh `PATH`.

```bash
npm config get prefix

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
hash -r

command -v frege
frege help
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

Load the key into `FREGE_API_KEY` through a secure local method, then connect
the CLI:

```bash
frege connect https://frege.dev --token "$FREGE_API_KEY"
frege doctor
```

Expected `frege connect` and `frege doctor` output includes the connected org, active org status, role, and key prefix. If either command fails, MCP setup is not complete; use a valid key for an active org.

For local development against a running Next dev server:

```bash
frege connect http://localhost:3000 --token "$FREGE_API_KEY"
frege doctor
```

Customer agents should connect to the hosted Frege API. Localhost is for development and smoke testing, not a supported self-hosted product mode.

After verification succeeds, `frege connect` writes local machine config to:

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

### Opt-in hosted HTTP

Clients implementing MCP `2026-07-28` may use `https://frege.dev/mcp` when the
hosted feature is enabled and the client can supply a custom Bearer header from
its secure credential store. This endpoint is read-only, keeps no protocol
session, and does not replace stdio for context builds, session writes,
proposals, document writes, or local Graphify. It is not an OAuth endpoint and
must not be configured by committing the raw key. See
[`STATELESS_MCP.md`](STATELESS_MCP.md) for exact protocol and rollout details.

## Install the local Frege Agent

Frege also publishes a complete local agent profile for Hermes. Use this when
the user wants an opinionated agent architecture rather than connecting an
existing Codex, Claude Code, or internal client. The canonical source is
[`Finberg-Laurelin-CEO/frege-agent`](https://github.com/Finberg-Laurelin-CEO/frege-agent).

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

The profile supplies Frege operating instructions, a safe MCP allowlist, and a
review-first organizational-memory workflow. The user still selects the model,
holds its provider credentials, and runs the agent and tools locally. The
profile contains no scheduled jobs or Frege-hosted execution.

## Local repo development

From a cloned Frege repo:

```bash
cd /path/to/frege.dev/packages/frege-cli
npm link
frege connect http://localhost:3000 --token "$FREGE_API_KEY"
frege doctor
frege mcp serve
```

## Common CLI commands

```bash
frege status
frege docs list
frege docs read frege-architecture
frege search "refund policy"
frege context "customer escalation steps"
frege mcp serve
frege agent install claude
frege agent install codex
frege agent install hermes
```

## Push Markdown Documents

Agents should use the CLI for user-approved document ingestion so the terminal shows exactly what was loaded and Frege audits every write.

Push one file:

```bash
frege docs push docs/ARCHITECTURE.md \
  --sensitivity public \
  --tag frege \
  --tag architecture
```

Preview a directory before writing:

```bash
frege docs push docs \
  --include "**/*.md" \
  --exclude "**/draft-*.md" \
  --sensitivity internal \
  --dry-run
```

Use a manifest for repeatable setup:

```bash
frege docs sync frege.docs.yml --dry-run
frege docs sync frege.docs.yml
frege context "how does Frege signup work?"
```

Markdown wikilinks such as `[[hosted brain architecture]]` are preserved in pushed documents. For canonical graph-connected brain pages, agents should submit reviewable wikilinked page proposals with `frege_write_page_proposal`.

## Agent execution boundary

The agent and its model run in the customer's environment. Frege MCP supplies
governed organizational context, session records, and reviewable memory tools;
it does not queue work for a Frege-hosted agent or send prompts to a model
provider. Model credentials remain with Codex, Claude Code, or the customer's
internal agent runtime.

## Troubleshooting

### `frege: command not found`

```bash
npm install -g @frege-dev/cli

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
command -v frege
```

### `EEXIST: file already exists`

This means an older local or GitHub install already created `frege` or `frege-mcp` on your PATH. Remove the old Frege package and stale wrappers, then reinstall:

```bash
npm uninstall -g @frege/cli @frege-dev/cli
rm -f ~/.local/bin/frege ~/.local/bin/frege-mcp
npm install -g @frege-dev/cli
```

### Node version error

```bash
node --version
```

Frege requires Node.js 20 or newer.

### `frege doctor` says the API key is missing

```bash
frege connect https://frege.dev --token "$FREGE_API_KEY"
frege doctor
```

### Wrong org or role

Create a new API key in the Frege admin console with the correct role, then reconnect:

```bash
frege connect https://frege.dev --token "$FREGE_API_KEY"
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
- Reads, session events, context builds, access decisions, and memory proposals show in telemetry/audit.
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
npm install -g @frege-dev/cli
npm update -g @frege-dev/cli
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
