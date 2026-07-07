# Frege-for-Frege Investor Demo Workflow

## Goal

Show that Frege uses Frege to build Frege: the product is the governed brain for its own agents, docs, deployment notes, billing decisions, and architecture.

Core line:

> We use Frege to build Frege. Every agent working on this product gets the same governed brain, but access is scoped, every answer is cited, and memory changes require review.

## Demo Account And Org

- User: `joe@frege.dev`
- Org: `frege-local`
- Host: `https://brain.frege.dev/console`

Use this org for the real demo because it already has roles, API keys, documents, brain pages, context builds, memory proposals, and audit history.

## Content To Load

Use curated docs, not raw repository dumps.

Green-zone Frege docs:

- Self-serve signup flow
- Stripe checkout and webhook activation flow
- Billing panel and promotion-code flow
- DB migration and local DB health-check notes
- MCP/API key setup
- Deployment checklist
- Hosted brain architecture
- Context gateway and trust-zone architecture

Red-zone Frege docs:

- Production operations checklist
- Stripe/admin operational notes
- Incident/security notes
- Pricing exception notes

Never ingest `.env` files, raw credentials, customer data, private keys, API tokens, or anything that should not be visible in a Loom.

## Loom Storyboard

Screen layout: browser on the left, terminal/agent on the right.

1. Open `brain.frege.dev/console` as `joe@frege.dev`.
2. Show the Frege org overview: live activity, context builds, denied reads, agents.
3. Switch to the knowledge view and show the Frege product brain: signup, billing, webhooks, MCP, deployment.
4. In the terminal, have the agent install/configure Frege using a dedicated demo API key.
5. Show the agent validating the install with `frege_status`.
6. Ask the agent to retrieve the current self-serve signup flow using `frege_build_context`.
7. Show in the browser that the context packet cites signup, billing, and webhook docs.
8. Ask the agent for restricted production/Stripe operational notes with a non-restricted role and show denied access.
9. Switch to an admin/restricted key or show the console access matrix explaining why the denial happened.
10. Have the agent use `frege_write_page_proposal` to propose a memory update from the current signup changes.
11. Show the proposal in the console and approve it.
12. Show the audit/activity ledger: what was read, what was denied, what was proposed, and who approved it.

## Agent-Led Install Moment

The ideal setup moment is not a manual docs walkthrough. It should look like:

1. User signs in or signs up.
2. User creates or reveals a scoped demo API key.
3. User asks their coding agent to install Frege.
4. Agent reads the short install instructions, updates MCP config, validates the connection, and asks Frege for project context.
5. Browser updates show the new agent activity and audit events.

Required product/docs improvements before a polished Loom:

- A shorter "Install with your agent" doc with copy/paste-safe commands.
- A simple MCP config snippet for Cursor/Codex/Claude Desktop style clients.
- Clear first query examples: `status`, `search`, `build context`, `propose memory update`.
- A visible verification step in the console after the first agent connection.
- A warning never to paste raw secrets into Loom-visible prompts or docs.

## MCP Commands To Demonstrate

- `frege_status`
- `frege_brain_status`
- `frege_search_pages`
- `frege_build_context`
- `frege_write_page_proposal`
- `frege_audit_events`

Use a fresh demo API key. Do not show the raw key in the video. Revoke or rotate the key after recording if it appears on screen.

## Auth And Access Follow-Up

Password login exists today, but the demo exposed a missing self-service recovery path. Required before recording:

- Password reset request screen.
- Password reset email.
- Password reset confirmation screen.
- Session revocation after password reset.

Customer SSO should be a separate follow-up:

- Google SSO for customer login.
- GitHub SSO for customer login.
- GitHub account/repository connection so Frege can understand user code/docs with explicit consent.
- Google account/workspace connection so Frege can later ingest approved docs with explicit consent.
- Evaluate a Vercel Marketplace auth integration for customer SSO so preview/prod env wiring is repeatable.
- Keep DB authorization as the source of truth for org membership and roles.
- The existing Auth0 integration is admin-oriented; customer SSO needs a deliberate product auth decision before investor demos.
