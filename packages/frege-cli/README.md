# @frege/cli

Frege CLI and MCP thin client.

Frege CLI is agent-side glue. It never touches the database. It stores a Frege API key locally, starts a stdio MCP server when asked, and calls Frege REST APIs for every command or tool call.

## Requirements

- Node.js 20 or newer
- npm
- A Frege API key that starts with `frg_live_`

```bash
node --version
npm --version
```

## Install

The target public package is `@frege/cli`:

```bash
npm install -g @frege/cli
```

Until `@frege/cli` is public, install from GitHub with npm:

```bash
npm install -g github:Finberg-Laurelin-CEO/frege.dev
```

Verify:

```bash
command -v frege
frege --help
```

## zsh PATH setup

If zsh cannot find `frege`, add npm's global bin directory to `PATH`:

```bash
npm config get prefix

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
hash -r

command -v frege
frege --help
```

If a GUI MCP client cannot find `frege`, use the absolute path from `command -v frege` in that client's MCP config.

## Connect

```bash
frege connect https://frege.dev --token frg_live_...
frege doctor
```

`connect` writes local machine config:

```text
~/.frege/mcp/config.json
```

The config file contains the Frege base URL and API key. It is local machine state and must not be committed. `FREGE_BASE_URL` and `FREGE_API_KEY` override this file for automation.

## Register MCP

Claude Code:

```bash
claude mcp add frege -- frege mcp serve
```

Codex:

```bash
codex mcp add frege -- frege mcp serve
```

Generic MCP JSON:

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

Prefer `frege connect` over embedding the API key in MCP JSON.

## Local development

From the Frege repo:

```bash
cd packages/frege-cli
npm link
frege connect http://localhost:3000 --token frg_live_...
frege doctor
frege mcp serve
```

## Common commands

```bash
frege status
frege search "refund policy"
frege context "customer escalation steps"
frege mcp serve
frege agent install claude
frege agent install codex
```

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

Frege requires Node.js 20 or newer:

```bash
node --version
```

### `frege doctor` says the API key is missing or invalid

```bash
frege connect https://frege.dev --token frg_live_...
frege doctor
```

If the org or role is wrong, create a new API key in Frege admin with the correct role, then reconnect.

## Security

- Frege CLI never reads the database directly.
- API keys are scoped by org, owner, and role.
- `~/.frege/mcp/config.json` is local secret state. Do not commit it.
- Rotate the API key in Frege admin if it appears in logs, shell history, screenshots, chat, or committed files.
- The API key remains revocable from Frege admin.

## npm now, Homebrew later

Use npm now because the CLI is Node-based and already exposes npm binaries. Add Homebrew later once releases, checksums, and a tap are stable.

```bash
# Now
npm install -g @frege/cli

# Fallback until @frege/cli is public
npm install -g github:Finberg-Laurelin-CEO/frege.dev

# Later
brew tap frege-dev/tap
brew install frege
```
