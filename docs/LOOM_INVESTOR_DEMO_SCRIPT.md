# Frege Investor Loom Demo Script

## Goal

Record a short investor Loom that shows Frege using Frege: a real local agent connects to the hosted Frege API with a scoped key, pushes the project docs into the Frege brain, asks for governed context, and shows the browser console updating with the same activity.

Core line:

> Frege is the shared memory layer for AI work. The browser is where humans govern it; MCP is how agents use it.

## Demo Identity

- Browser user: `joe@frege.dev`
- Org: `frege-local`
- API base for CLI and MCP: `https://frege.dev`
- Browser app: `https://brain.frege.dev`
- Demo key prefix: `c02d8a99ee7a`

Do not show the raw API key in Loom. If it appears on screen, rotate it after recording.

## Screen Setup

- Left side: browser at `https://brain.frege.dev/console`.
- Right side: terminal or coding agent in `/Users/Joe/frege/frege.dev`.
- Keep the raw key out of terminal history and visible prompts.
- Start with the terminal already connected, or reconnect through a hidden prompt before recording.

## Preflight

Run these before recording:

```bash
git status --short --branch
frege doctor
frege docs sync frege.docs.yml --dry-run
```

Expected connection:

```text
baseUrl: https://frege.dev
org: frege-local
orgStatus: active
role: admin
key: c02d8a99ee7a
```

## Recording Flow

### 1. Open with the product shape

Show `https://frege.dev/docs` for 10-15 seconds.

Say:

> Frege is hosted. Users manage the browser app; agents install a small local CLI. The MCP server runs locally as `frege mcp serve` and calls the hosted Frege API with a scoped key.

Point at the distinction:

- Human app: `https://brain.frege.dev`
- API base: `https://frege.dev`
- CLI: `@frege-dev/cli`
- MCP command: `frege mcp serve`

### 2. Show the live org

Switch to `https://brain.frege.dev/console` logged in as `joe@frege.dev`.

Show:

- Org is `frege-local`.
- Roles and API keys exist.
- Documents and brain pages exist.
- Activity/audit is visible.

Say:

> This is not a mock walkthrough. The same org this Loom is using has the docs, keys, context builds, and audit trail behind the demo.

### 3. Agent verifies its connection

In the terminal:

```bash
frege doctor
```

Then show MCP status through the agent or the raw MCP smoke if needed:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"frege-demo-smoke","version":"0.0.1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"frege_status","arguments":{}}}' \
  | FREGE_MCP_TRANSPORT=jsonl frege mcp serve
```

Say:

> The agent does not touch the database. It only has the API key, and Frege resolves that key into an org, role, allowed labels, and capabilities.

### 4. Push the actual Frege docs into Frege

Run:

```bash
frege docs sync frege.docs.yml --dry-run
frege docs sync frege.docs.yml
```

Point out the curated manifest:

```bash
sed -n '1,120p' frege.docs.yml
```

Say:

> We are not dumping a repository blindly. The manifest chooses which docs become governed company context.

Current demo docs:

- `frege-overview`
- `investor-demo-workflow`
- `hosted-brain-architecture`
- `frege-mcp-install`
- `frege-cli-readme`
- `frege-cli-install-for-agents`
- `stripe-changelog`
- `prototype-operations`
- `frege-investor-loom-demo-script`

### 5. Prove the docs are readable

Run:

```bash
frege docs list
frege docs read investor-demo-workflow
frege docs search "Frege MCP Install"
```

Say:

> Now the agent can read the same docs a human can see, but through the governed API surface.

### 6. Ask for context like an agent would

Run:

```bash
frege context "how should an agent install Frege MCP and push docs for the investor demo?"
```

Then ask the coding agent:

```text
Using Frege context, summarize how an agent should install Frege MCP and push this repo's docs for the investor demo. Cite the Frege document slugs you used.
```

Say:

> Frege is not just search. The context packet returns cited, scoped material the agent can use before it answers.

### 7. Show governance

In the browser, show:

- Activity/audit for the key.
- Documents updated by the demo key.
- Any context build record visible in the console.
- Roles and allowed labels.

Say:

> This is the point for companies: agents can use shared memory without getting blanket access to every secret, and every read/write is attributable.

### 8. Close with why it matters

Say:

> Teams are already adopting Codex, Claude Code, Cursor, and internal agents. Frege gives all of them one governed company brain instead of separate markdown folders and invisible context servers.

## Backup Commands

If the agent UI is not restarted after MCP registration, use CLI commands in the Loom:

```bash
frege doctor
frege docs sync frege.docs.yml
frege docs list
frege docs read investor-demo-workflow
frege docs search "Frege MCP Install"
frege context "how does Frege use Frege for the investor demo?"
```

If search is too broad, use exact or simple terms:

```bash
frege docs search "Frege MCP Install"
frege docs search "install"
```

## Follow-Up Docs To Add

Create and sync these before a more polished second Loom:

- `docs/SELF_SERVE_SIGNUP_FLOW.md`
- `docs/BILLING_AND_STRIPE_ACTIVATION.md`
- `docs/CUSTOMER_AUTH_AND_SSO_PLAN.md`
- `docs/DEMO_ACCESS_CONTROL_SCENARIOS.md`
- `docs/AGENT_MEMORY_REVIEW_WORKFLOW.md`

Keep each doc short, curated, and safe to show on screen.
