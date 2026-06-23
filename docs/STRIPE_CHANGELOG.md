# Stripe Integration — Changelog / Handoff

Last updated: 2026-06-23. Audience: the agent working on `main` at
`/Users/Joe/frege/frege.dev`. Read this before touching billing.

## TL;DR

- Stripe billing is **deployed and live in production** (frege.dev) in **TEST/SANDBOX
  mode**. Test cards work; real cards do not charge yet.
- All work is merged to `origin/main` at commit `6ba0b5b`. **Run `git pull` in your
  main worktree** — your local checkout does not have it until you do.
- Production auto-deployed from the push to main (Vercel deploy `frege-dyfzc7el8`,
  Ready). The new routes are verified live (return 401 unauth, not 404).

## Stripe account / environment

- **Sandbox account:** `acct_1TlYvFHO6GG2AdfR` ("frege.dev-sandbox").
- Dashboard: https://dashboard.stripe.com/acct_1TlYvFHO6GG2AdfR/test/dashboard
- Mode is encoded in the key prefix: `sk_test_` = TEST/SANDBOX, `sk_live_` = LIVE.
- Source of truth for production = the **Vercel** env vars (stored sensitive/encrypted,
  so `vercel env pull` returns them BLANK — that is expected, not a bug).

### Objects in the sandbox (test mode)

| Item | ID | Notes |
|---|---|---|
| Solo $20/mo | `price_1TlYxBHO6GG2AdfRAgcvngAq` | |
| Team Monthly $20/seat/mo | `price_1TlYxCHO6GG2AdfRFBWQxxgx` | per-seat (licensed) |
| Team Annual $180/seat/yr | `price_1TlYxDHO6GG2AdfRETk2Q9hU` | per-seat (licensed) |
| Webhook | `we_1TlYxJHO6GG2AdfRcTT3pG1n` | -> https://frege.dev/api/v1/billing/webhook |
| Billing portal config | `bpc_1TlZ8gHO6GG2AdfRcQ1JjwHm` | default; seat (quantity) updates enabled |

Note: earlier Frege products created in the MAIN Laurelin account
(`acct_1SMojiHusNp8E6pI`) were a mistake and have been **archived** there. Use only the
sandbox account above.

## Local tooling (this machine)

- **Stripe CLI** installed at `/usr/local/bin/stripe` (on PATH for any shell).
- **Keys for local CLI use:** `.env.stripe.local` at the repo root. This file is
  git-ignored — do NOT commit it, do NOT paste its contents into chat.
  ```bash
  set -a; source .env.stripe.local; set +a
  stripe products list --api-key "$STRIPE_SECRET_KEY"
  ```
  The file holds the sandbox `sk_test_`/`pk_test_`/`whsec_` and the three price IDs,
  mirroring Vercel production.

## What shipped in `6ba0b5b` (this round)

- `POST /api/v1/billing/portal` — org admins open the Stripe Customer Portal to change
  seats, payment method, or cancel. Returns `no_subscription` (409) if the org has no
  Stripe customer yet. **Live.**
- `POST /api/v1/platform/orgs/[id]/billing-portal` — platform staff open a customer's
  portal from the admin console. **Live.**
- Webhook (`/api/v1/billing/webhook`) now reads subscription line-item quantity on
  `customer.subscription.updated` and **syncs the seat count into `org_billing.seats`**,
  so the member-access gate matches what is actually paid for.
- `app/billing/BillingPanel.tsx`: "Manage billing & seats" button.
- `app/platform/PlatformConsole.tsx`: per-org "billing" button (only shown when the org
  has a subscription_status).
- `docs/SUPPORT_TICKETS_REQUIREMENTS.md`: requirements for an in-product support ticket
  system (NOT built — deferred for you to design). No DB model exists yet.

## Not done yet (your call)

1. **Go-live (real money).** Still test mode. Requires: live-mode products/prices,
   `sk_live_` secret key, a live webhook, and swapping the Vercel env vars. See
   `docs/STRIPE_SETUP.md` for the full live switch. Do this only after a test payment
   verifiably activates an org.
2. **Support tickets.** Greenfield. See `docs/SUPPORT_TICKETS_REQUIREMENTS.md` for the
   open product decisions (ticket origin, who replies, SLA) and a suggested schema.
