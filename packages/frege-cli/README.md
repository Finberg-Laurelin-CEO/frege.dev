# @frege-dev/cli

Frege CLI and MCP thin client.

Frege CLI is agent-side glue. It never touches the database. It stores a Frege API key locally, starts a stdio MCP server when asked, and calls Frege REST APIs for every command or tool call.

The agent, model, and tools keep running in the customer's environment. This
client only connects that work to Frege's governed memory, context, sessions,
and review path; it does not send prompts to a Frege-hosted model runtime.

You can connect an agent you already use, or install the downloadable Frege
Agent profile for Hermes. The profile is an opinionated local agent, not a
Frege-hosted process: Hermes, the selected model, and all tool execution stay
on infrastructure you control.

The browser app may run on `https://brain.frege.dev`. MCP does not care about that subdomain; connect the CLI to the canonical API base, usually `https://frege.dev`.

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
npm install -g @frege-dev/cli
```

Verify:

```bash
command -v frege
frege help
```

## zsh PATH setup

If zsh cannot find `frege`, add npm's global bin directory to `PATH`:

```bash
npm config get prefix

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
hash -r

command -v frege
frege help
```

If a GUI MCP client cannot find `frege`, use the absolute path from `command -v frege` in that client's MCP config.

## Connect (one command)

Load the key into `FREGE_API_KEY` through a secure local method first.

```bash
frege connect https://frege.dev --token "$FREGE_API_KEY"
```

`frege connect` does four things:

1. Verifies that the API key is valid for an active Frege org.
2. Saves local config to `~/.frege/mcp/config.json`.
3. Prints your org, active org status, role, and key prefix.
4. Auto-registers `frege mcp serve` with any MCP client it finds (Claude Code, Codex).

Expected output:

```text
Frege config saved to ~/.frege/mcp/config.json
Connected: org acme (active), role reader, key abc123

Registering Frege with Claude Code... done
Registering Frege with Codex... done

You're set. Restart your MCP client if it was already running.
```

That is the whole setup. If verification fails, Frege MCP is not connected; use a valid key for an active org and run `frege connect` again. The config file contains the Frege base URL and API key; it is local machine state and must not be committed. `FREGE_BASE_URL` and `FREGE_API_KEY` override this file for automation.

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

## Install the local Frege Agent

[Hermes Agent](https://github.com/NousResearch/hermes-agent) can install a
complete local agent profile containing Frege's operating instructions, safe
memory workflow, and MCP connection. Install Hermes, connect this CLI, and then
install the profile:

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

`frege-agent setup` asks you to choose your own model provider. Frege does not
receive that provider credential and does not run the agent's compute.
The official profile source is
[`Finberg-Laurelin-CEO/frege-agent`](https://github.com/Finberg-Laurelin-CEO/frege-agent).

## Local development

From the Frege repo:

```bash
cd packages/frege-cli
npm link
frege connect http://localhost:3000 --token "$FREGE_API_KEY"
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
frege agent install hermes
```

## Optional local Graphify code context

Frege can use a customer-installed Graphify fork as an opt-in, local-only code
graph. Pin the accepted fork; the upstream `graphifyy` 0.9.34 package does not
contain the required Frege v1 export contract.

```bash
uv tool install --force "git+https://github.com/Finberg-Laurelin-CEO/graphify-frege.git@d61ab06a2c23d4bcf2c748b573e6b13b309ee0d4"
graphify --version

export FREGE_CODE_GRAPH=true
frege code index .
frege code doctor
frege code query "where is context assembled?" --budget 2000
```

With the flag set, MCP also registers `frege_code_graph_query` and
`frege_code_context`. The first is entirely local. The combined tool sends only
its query and bounded result limit to the existing Frege context endpoint, then
joins that response with the local Graphify result in this CLI process. Source,
`graph.json`, the v1 export, and local query results are never included in the
hosted request or telemetry.

`GRAPHIFY_OUT` may select another output directory inside the current project.
`FREGE_GRAPHIFY_BIN` may name an executable path. Project escapes, symlink
escapes, incompatible schemas, oversized files/output, and timeouts fail closed.
Unset `FREGE_CODE_GRAPH` to remove the commands and MCP tools without changing
any hosted Frege behavior.

## Experimental: live Codex run rooms

With the server-side feature flag enabled, start a local Codex App Server and
publish its live activity to a private Frege run room:

```bash
FREGE_LIVE_RUN_ROOMS=true frege run codex
FREGE_LIVE_RUN_ROOMS=true frege run codex -- -c model="gpt-5"
```

The command uses the existing Frege connection, prints the private watch URL,
and leaves Codex execution and its sandbox/approval policy on this machine.
Unsent ledger events are spooled under `~/.frege/run-rooms/` if Frege stays
unreachable after retries.

## Push Markdown Documents

Use the CLI to push markdown into the Frege document store. Markdown is preserved, including normal links and wikilinks such as `[[self-serve signup]]`.

```bash
frege docs push docs/ARCHITECTURE.md \
  --sensitivity public \
  --tag frege \
  --tag architecture
```

Push a directory with include/exclude filters:

```bash
frege docs push docs \
  --include "**/*.md" \
  --exclude "**/draft-*.md" \
  --sensitivity internal \
  --dry-run
```

Use a manifest for repeatable agent-led ingestion:

```yaml
base: .
defaults:
  sensitivity: public
  tags: [frege, public-docs]
documents:
  - path: docs/ARCHITECTURE.md
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
npm install -g @frege-dev/cli

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
command -v frege
```

### `EEXIST: file already exists`

This usually means an older local or GitHub install already created `frege` or `frege-mcp` on your PATH. Remove the old Frege package and any stale wrappers, then reinstall:

```bash
npm uninstall -g @frege/cli @frege-dev/cli
rm -f ~/.local/bin/frege ~/.local/bin/frege-mcp
npm install -g @frege-dev/cli
```

### Node version error

Frege requires Node.js 20 or newer:

```bash
node --version
```

### `frege doctor` says the API key is missing or invalid

```bash
frege connect https://frege.dev --token "$FREGE_API_KEY"
frege doctor
```

If this fails, the key may be invalid, revoked, expired, or attached to an inactive org. If the org or role is wrong, create a new API key in Frege admin with the correct role, then reconnect.

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
npm install -g @frege-dev/cli

# Later
brew tap frege-dev/tap
brew install frege
```
