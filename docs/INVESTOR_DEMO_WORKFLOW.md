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

1. Open `brain.frege.dev/console` as `joe@frege.dev`.
2. Show the Frege org overview: live activity, context builds, denied reads, agents.
3. Switch to the knowledge view and show the Frege product brain: signup, billing, webhooks, MCP, deployment.
4. Use MCP live from the terminal with a dedicated demo API key.
5. Run `frege_status` to show the key resolves to the Frege org and role.
6. Ask Frege for the current self-serve signup flow using `frege_build_context`.
7. Show that the context packet cites signup, billing, and webhook docs.
8. Ask for restricted production/Stripe operational notes with a non-restricted role and show denied access.
9. Switch to an admin/restricted key or show the console access matrix explaining why the denial happened.
10. Use `frege_write_page_proposal` to propose a memory update from the current signup changes.
11. Show the proposal in the console and approve it.
12. Show the audit/activity ledger: what was read, what was denied, what was proposed, and who approved it.

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

- Google SSO for customer users.
- GitHub SSO for developer/customer users.
- Evaluate a Vercel Marketplace auth integration for customer SSO so preview/prod env wiring is repeatable.
- Keep DB authorization as the source of truth for org membership and roles.
- The existing Auth0 integration is admin-oriented; customer SSO needs a deliberate product auth decision before investor demos.
