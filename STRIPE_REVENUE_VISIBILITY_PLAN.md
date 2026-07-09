# Stripe Revenue Visibility Plan

Branch: `feature/stripe-revenue-visibility`

## Goal
Use Stripe API data to improve payment/revenue visibility in the admin panel and verify the signup → invite → billing → active-org flow.

## Current state

- User checkout route: `app/api/v1/billing/checkout/route.ts`
- Stripe webhook route: `app/api/v1/billing/webhook/route.ts`
- User billing UI: `app/billing/BillingPanel.tsx`
- Platform payments overview: `app/api/v1/platform/payments/overview/route.ts`
- Platform console payments UI: `app/platform/PlatformConsole.tsx`
- Billing helper: `lib/core/billing.ts`
- Billing state table: `org_billing`

The current payments tab shows MRR, active/past-due subscription counts, recent charges, open invoices, and payout status. It does not yet show revenue per org/user, ARR, signup-to-paid attribution, or approved-but-unpaid funnel stalls.

## Implementation steps

1. **Extract Stripe revenue helpers**
   - In `lib/core/billing.ts`, add helpers for:
     - computing MRR/ARR from active/trialing subscriptions
     - computing customer revenue from charges/refunds
   - Use Stripe auto-pagination where possible.

2. **Improve platform payments overview**
   - Update `app/api/v1/platform/payments/overview/route.ts`:
     - add `arr_cents`
     - allow `?limit=` for recent charges, max 100
     - map Stripe customer IDs back to `org_billing.stripe_customer_id` so charge rows can include `org_slug` / `org_name` when available
     - keep existing insufficient-permission handling

3. **Add revenue summary endpoint**
   - Create `app/api/v1/platform/revenue/summary/route.ts`.
   - Platform-staff gated.
   - Return per-org revenue:
     - org slug/name/status
     - plan/billing interval/seats
     - subscription status
     - total charged cents
     - total refunded cents
     - net revenue cents
     - charge count
   - Include top-level totals: total charged, total refunded, net revenue, MRR, ARR, active subscriptions.

4. **Add signup/billing verification visibility**
   - Add an idempotent migration if needed, e.g. `signups.paid_at timestamptz`.
   - On `checkout.session.completed`, update the related signup `paid_at` when it can be inferred through invite/org linkage.
   - Add an action-queue item for approved/invited signups whose org is still inactive after 3 days.

5. **Improve PlatformConsole payments/revenue UI**
   - In `app/platform/PlatformConsole.tsx`:
     - display ARR next to MRR
     - show org/customer on recent charges when available
     - add a revenue table for per-org revenue
     - keep destructive actions confirmed before execution

6. **Webhook reliability**
   - Keep the current idempotent upsert behavior.
   - If adding event logging/deduping, do it with an idempotent table/migration and do not break existing webhook handling.

## Verification

Run:

```bash
pnpm typecheck
pnpm build
```

Manual/API checks:

- `GET /api/v1/platform/payments/overview` works as platform staff.
- `GET /api/v1/platform/revenue/summary` works as platform staff.
- Stripe insufficient permissions produce a readable admin error, not a crash.
- Checkout success still redirects to `/billing?status=success&org=...`.
- Webhook still activates paid orgs.
- Approved-but-unpaid signups appear in the action queue.

## Out of scope

- Do not change public pricing numbers unless coordinated with `feature/public-value-prop`.
- Do not migrate user auth here.
- Do not add fake revenue data.
