# Frege Investor Loom Demo Script

## Goal

Record a short investor Loom that shows Frege using Frege: a real local agent connects to the hosted Frege API with a scoped key, pushes the project docs into the Frege brain, asks for governed context, gets refused on a red-zone doc, proposes a memory update that a human approves, and shows the browser console updating with the same activity.

Core line:

> Frege is the shared memory layer for AI work. The browser is where humans govern it; MCP is how agents use it.

## Demo Identity

- Browser user: `joe@frege.dev`
- Org: `frege-local`
- API base for CLI and MCP: `https://frege.dev`
- Browser app: `https://brain.frege.dev`
- Demo key prefix: `c02d8a99ee7a`

Do not show the raw API key in Loom. If it appears on screen, rotate it after recording.

Identity note (2026-07-09): the org's original bootstrap admin is `joe@laurelin-inc.com`
(see `docs/LOCAL_WORKLOG.md` and `docs/ADMIN_ACCESS.md`; it is also platform staff).
The on-screen browser identity for this Loom is `joe@frege.dev`. Before recording,
sign in as `joe@frege.dev` and confirm it is a member of `frege-local` with the admin
role; if it is not, invite it from `/admin` (Members → invite) first. Keep
`joe@laurelin-inc.com` off screen.

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

One-line check: `frege doctor` must show `org: frege-local`, `orgStatus: active`,
`role: admin`, `key: c02d8a99ee7a`. If `orgStatus` is not `active`, doctor exits
nonzero and the demo is blocked.

Two more preflight requirements for the governance beats (full recording-day list in
`docs/DEMO_OPERATOR_CHECKLIST.md`):

1. **Red-zone docs must exist in the org.** `frege.docs.yml` now includes the two
   restricted demo docs (`security-provider-key-handling`,
   `security-red-zone-handling`). Syncing them requires a key whose role carries the
   `restricted` label, so run the full `frege docs sync frege.docs.yml` once with the
   admin demo key before recording. Operator alternative (direct DB import into the
   live org, off camera — do not run during the Loom):

   ```bash
   vercel pull --yes --environment=production --scope laurelin-inc
   node --env-file=./.vercel/.env.production.local \
     scripts/prototype/import-markdown-dir.mjs frege-local demo-data/frege-demo-docs/red restricted published
   node --env-file=./.vercel/.env.production.local \
     scripts/prototype/index-semantic-map.mjs frege-local
   rm -rf .vercel
   ```

2. **A green-only writer key for the denial beat.** The admin demo key carries the
   `restricted` label, so red-zone reads through it succeed. Create a writer-role key
   (labels `public,internal` only) in the console, and export it off camera before
   recording so only the variable name appears on screen:

   ```bash
   export FREGE_WRITER_KEY=frg_live_...   # hidden prompt, never on screen
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

Restricted demo docs (synced in preflight, invisible to green-only keys):

- `security-provider-key-handling`
- `security-red-zone-handling`

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

### 7. The denied read

Now ask for something the agent should not have. Run both through the green-only writer key (exported in preflight; only the variable name shows on screen):

```bash
FREGE_API_KEY="$FREGE_WRITER_KEY" frege docs read security-provider-key-handling
FREGE_API_KEY="$FREGE_WRITER_KEY" frege context "provider key handling"
```

Expected: the direct read returns `not_found` — restricted titles and bodies never leak, not even in the error. The context packet returns a nonzero `denied_count` with no red-zone content.

Flip to the browser: console → **access** ("Access & trust zones"). Point at the writer role's labels — `public, internal` — no `restricted`.

Say:

> That doc covers Stripe and provider-key handling. It is red-zone. The agent's key resolves to a role without the restricted label, so Frege refuses — and the access matrix shows exactly why. The agent cannot even confirm the doc exists.

### 8. Propose a memory update

Agents do not rewrite the company brain directly. Ask the coding agent:

```text
Using the frege_write_page_proposal tool, propose a brain page titled "Investor demo recording notes" summarizing what we set up in this session. Keep it green trust zone.
```

Flip to the browser: console → **knowledge** (reviewable proposals). Show the pending proposal, then approve it.

Say:

> The agent proposed the memory change; it did not make it. A human reviewed and approved it, and only then did it become canonical org memory. That review step is the difference between shared memory and agents silently rewriting your company's knowledge.

### 9. Show governance

In the browser, show:

- Activity/audit for the key: what was read, what was denied, what was proposed, and who approved it.
- Documents updated by the demo key.
- Any context build record visible in the console.
- Roles and allowed labels.

Say:

> This is the point for companies: agents can use shared memory without getting blanket access to every secret, and every read/write is attributable.

### 10. Close with why it matters

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
FREGE_API_KEY="$FREGE_WRITER_KEY" frege docs read security-provider-key-handling
FREGE_API_KEY="$FREGE_WRITER_KEY" frege context "provider key handling"
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
