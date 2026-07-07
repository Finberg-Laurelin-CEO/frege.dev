# Frege CLI Installation Guide For Agents

Read this file, then install the Frege CLI for the user. Do not ask the user to paste API keys into browser JSON. Install the CLI, make sure the shell can call `frege`, connect once, run `frege doctor`, then register `frege mcp serve` with the MCP client.

The browser app may live at `https://brain.frege.dev`, but MCP does not depend on that subdomain. The CLI only needs an API base URL that serves Frege's `/api/v1` routes. Use `https://frege.dev` as the canonical hosted API base unless Frege support gives the user a different one.

## Step 1: Get the Frege connection details

Ask the user for:

```text
FREGE_BASE_URL
FREGE_API_KEY
```

Hosted pilot default:

```text
FREGE_BASE_URL=https://frege.dev
```

For local development only:

```text
FREGE_BASE_URL=http://localhost:3000
```

The API key starts with:

```text
frg_live_
```

Never print the full key after you receive it. If it appears in logs or chat, tell the user to rotate it.

## Step 2: Confirm Node.js 20+

```bash
node --version
npm --version
```

Frege requires Node.js 20 or newer. If Node is too old, stop and tell the user to install or activate Node 20+ before continuing.

## Step 3: Install the CLI

```bash
npm install -g @frege-dev/cli
```

Local repo development path:

```bash
cd /path/to/frege.dev/packages/frege-cli
npm link
```

Verify:

```bash
command -v frege
frege help
```

## Step 4: Make zsh able to call `frege`

If `command -v frege` fails in zsh, add npm's global bin directory to `~/.zshrc`:

```bash
npm config get prefix

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
hash -r

command -v frege
frege help
```

If the MCP client is launched from a GUI and still cannot find `frege`, use the absolute path from `command -v frege` in the client config.

## Step 5: Connect the token

```bash
frege connect "$FREGE_BASE_URL" --token "$FREGE_API_KEY"
frege doctor
```

`frege doctor` should show the connected org, role, and key prefix. If the org or role is wrong, ask the user for a new API key with the correct role.

`connect` stores local machine config at:

```text
~/.frege/mcp/config.json
```

Do not commit this file. `FREGE_BASE_URL` and `FREGE_API_KEY` environment variables override this file for automation.

## Step 6: Register with the agent

Use the agent's native MCP registration command.

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

If the client cannot resolve `frege`, replace `"command": "frege"` with the absolute path from `command -v frege`.

Do not embed the API key in the client config unless the client cannot run local commands. Prefer `frege connect`, which stores the token once in the user's home directory.

## Step 7: Verify MCP behavior

After registering the MCP server, call the Frege status tool from the client. It should report the same org, role, and key prefix shown by `frege doctor`.

If the client supports tool discovery, confirm tools such as:

```text
frege_status
frege_brain_status
frege_build_context
frege_search_pages
frege_get_page
frege_write_page_proposal
frege_start_session
frege_append_session_event
frege_list_agents
frege_run_agent
frege_get_agent_run
frege_create_document
frege_read_document
frege_search_documents
```

## Step 8: Push user-approved markdown

If the user asks you to load docs into Frege, prefer the CLI so the action is visible in terminal and audited by Frege.

Push one file:

```bash
frege docs push docs/INVESTOR_DEMO_WORKFLOW.md \
  --sensitivity internal \
  --tag demo \
  --tag frege
```

Preview a directory first:

```bash
frege docs push docs \
  --include "**/*.md" \
  --exclude "**/HANDOFF.md" \
  --sensitivity internal \
  --dry-run
```

Use a manifest when the repo provides one:

```bash
frege docs sync frege.docs.yml --dry-run
frege docs sync frege.docs.yml
```

Markdown wikilinks such as `[[hosted brain architecture]]` are okay to preserve in pushed documents. For canonical wikilinked brain pages and graph traversal, submit a reviewable page proposal with `frege_write_page_proposal` rather than silently changing canonical memory.

## Operating protocol

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

## Troubleshooting

### `frege: command not found`

```bash
npm install -g @frege-dev/cli

echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
command -v frege
```

### `EEXIST: file already exists`

An older local or GitHub install may already own `frege` or `frege-mcp`. Remove old Frege installs and stale wrappers, then reinstall:

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

### `frege doctor` says the API key is missing or invalid

```bash
frege connect "$FREGE_BASE_URL" --token "$FREGE_API_KEY"
frege doctor
```

### Wrong org or role

Ask the user to create a new API key in the Frege admin console with the correct role, then reconnect.

### MCP client cannot find `frege`

Use the absolute path returned by:

```bash
command -v frege
```

Then configure that path as the MCP command, keeping `args` as `["mcp", "serve"]`.

## Hosted agent tools

The MCP server exposes these hosted-runtime tools when the connected key has `canExecuteAgents`:

```text
frege_list_agents
frege_run_agent
frege_get_agent_run
```

Hosted agent runs are asynchronous. After `frege_run_agent`, poll `frege_get_agent_run` until `status` is `succeeded`, `failed`, or `cancelled`. Do not call runtime endpoints directly; they are reserved for Frege workers and require `FREGE_RUNTIME_TOKEN`.

## Security

- Frege CLI never reads the database directly.
- Frege CLI only calls REST APIs with the user's API key.
- API keys are scoped by org role and owner user.
- Admins can revoke keys in Frege.
- `~/.frege/mcp/config.json` is local secret state. Do not commit it.
- Rotate the API key if it appears in logs, shell history, screenshots, chat, or committed files.
- Prefer `frege connect` over storing `FREGE_API_KEY` in MCP client JSON.

## Install channel guidance

Use npm now. Add Homebrew later.

```bash
# Now
npm install -g @frege-dev/cli

# Later
brew tap frege-dev/tap
brew install frege
```

npm is the right first channel because Frege CLI is Node-based and already exposes npm binaries. Homebrew is useful after CLI usage is proven and releases are stable enough to maintain a tap, tarballs, and checksums.
