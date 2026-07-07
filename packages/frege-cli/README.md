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

```bash
npm install -g @frege/cli
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

## Connect (one command)

```bash
frege connect https://frege.dev --token frg_live_...
```

`frege connect` does three things:

1. Saves local config to `~/.frege/mcp/config.json`.
2. Verifies the key against Frege and prints your org, role, and key prefix.
3. Auto-registers `frege mcp serve` with any MCP client it finds (Claude Code, Codex).

Expected output:

```text
Frege config saved to ~/.frege/mcp/config.json
Connected: org acme, role reader, key abc123

Registering Frege with Claude Code... done
Registering Frege with Codex... done

You're set. Restart your MCP client if it was already running.
```

That is the whole setup. The config file contains the Frege base URL and API key; it is local machine state and must not be committed. `FREGE_BASE_URL` and `FREGE_API_KEY` override this file for automation.

## Register MCP manually

`frege connect` registers automatically. If a client was not detected (install its CLI first), register it explicitly:

```bash
frege agent install claude
frege agent install codex
```

To connect without auto-registering, pass `--no-register`. Generic MCP JSON:

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
frege docs list
frege docs read hosted-brain-architecture
frege search "refund policy"
frege context "customer escalation steps"
frege mcp serve
frege agent install claude
frege agent install codex
```

## Push Markdown Documents

Use the CLI to push markdown into the Frege document store. Markdown is preserved, including normal links and wikilinks such as `[[self-serve signup]]`.

```bash
frege docs push docs/INVESTOR_DEMO_WORKFLOW.md \
  --sensitivity internal \
  --tag frege-demo \
  --tag operations
```

Push a directory with include/exclude filters:

```bash
frege docs push docs \
  --include "**/*.md" \
  --exclude "**/HANDOFF.md" \
  --sensitivity internal \
  --dry-run
```

Use a manifest for repeatable agent-led ingestion:

```yaml
base: .
defaults:
  sensitivity: internal
  tags: [frege, product]
documents:
  - path: docs/INVESTOR_DEMO_WORKFLOW.md
  - path: docs/HOSTED_BRAIN_ARCHITECTURE.md
  - path: docs/FREGE_MCP_INSTALL.md
```

Then sync it:

```bash
frege docs sync frege.docs.yml
frege context "how does Frege signup work?"
```

For canonical brain pages and graph traversal, have the agent propose wikilinked pages with `frege_write_page_proposal`; a human can review and accept the proposal in Frege.

## Troubleshooting

### `frege: command not found`

```bash
npm install -g @frege/cli

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

# Later
brew tap frege-dev/tap
brew install frege
```
