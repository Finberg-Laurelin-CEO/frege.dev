# Billing / Stripe Plan — deferred to last

## Decision
Get the product working end-to-end first (self-serve apply flow, CLI, docs), then
add Stripe **last** so payments wrap a finished flow.

## Access model decision
- Keep `/signup` as **apply-to-join the pilot** (no open self-serve account creation).
- Payment is the gate: an approved applicant pays via Stripe, which provisions/activates
  their account + org.

## Stripe specifics (confirmed intent)
- Process through the existing **Laurelin Stripe account** (to be confirmed at build time).
- Plans:
  - Solo: $20 / month (single user)
  - Team monthly: $20 / user / month
  - Team annual: $15 / user / month, billed annually ($180/user/year upfront)
  - Enterprise: custom → /contact (no Stripe self-serve)

## What I need before building Stripe (BLOCKERS — only the founder can provide)
1. Stripe **test** secret key `sk_test_...` (and publishable `pk_test_...` if client-side).
2. Three **Price IDs** created in Stripe (test mode) for solo / team-monthly / team-annual.
3. Webhook signing secret `whsec_...` (after I provide the endpoint URL to register).
4. Confirm Laurelin account + test-vs-live mode for the pilot.
- Provide keys via `vercel env add` or Stripe CLI/MCP — never paste secret keys in chat.

## Planned implementation (when unblocked)
- `db/0xx_billing.sql`: subscriptions/customers tables linking org -> stripe_customer_id,
  stripe_subscription_id, plan, status, seats.
- `POST /api/v1/billing/checkout`: creates a Stripe Checkout Session for a chosen plan/seats.
- `POST /api/v1/billing/webhook`: signature-verified (mirror lib/hermes-webhook HMAC pattern);
  on `checkout.session.completed` / subscription events, provision or activate org + seats.
- Wire pricing page CTAs -> checkout for approved/paid users.
- Seat enforcement for team plans (members <= seats).

## Status
Deferred. Building CLI auto-setup + docs first.
