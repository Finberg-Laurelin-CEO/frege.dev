# INCIDENT — Stripe live-mode webhook deliveries failing (RESOLVED 2026-07-10)

Opened: 2026-07-09. Resolved: 2026-07-10. Severity was **critical**.

## RESOLUTION

**Root cause: `STRIPE_WEBHOOK_SECRET` in Vercel production never matched the live
endpoint's signing secret.** Every delivery since the endpoint's creation (2026-06-23)
reached the function and got a 400 from signature verification — before the ledger
write, which is why `stripe_webhook_events` was empty and the failure looked
transport-level. Stripe's email bucketing the 400s as "other errors" sent the
investigation through DNS/DNSSEC/firewall/IP-space dead ends; Vercel runtime logs
(`vercel logs` during a live `stripe events resend`) provided the ground truth.

Actions taken (Claude, with Joe's live key, 2026-07-10):
1. Created replacement endpoint `we_1Tri3aHNWHq5KubIprPIHL3I` →
   `https://frege.dev/api/v1/billing/webhook` (same 6 event types); captured its
   signing secret at creation (the only moment Stripe reveals it).
2. Replaced `STRIPE_WEBHOOK_SECRET` in Vercel production (sensitive) and redeployed.
3. Resent all 6 pending events (2 checkouts + 2 subscription.created + 2 invoice.paid)
   → all `processed` in the ledger.
4. **Both stranded customers activated**: `kismet` (team annual, 2 seats — real revenue,
   stranded 3 days) and `test` (solo monthly). `signups.paid_at` 1 → 3.
5. Deleted the broken endpoint `we_1TlasVHNWHq5KubIDIuzqhnq`; Stripe's disable
   deadline is moot.
6. Stripe's 15 published webhook egress IPs added to Vercel firewall System Bypass
   (done during investigation; harmless and recommended, kept).
7. Live key + new signing secret stored in `.env.stripe-live.local` (gitignored).

Still open: the hardening follow-ups at the bottom (webhook-silence alert especially),
and Joe's call on whether to email kismet an apology for the 3-day activation delay.

---

Original investigation notes below (pre-resolution).

## Stripe's notice (received 2026-07-09)

> We've had some trouble sending requests in live mode to a webhook endpoint associated with
> your Frege account. The URL of the failing webhook endpoint is:
> `https://frege.dev/api/v1/billing/webhook`.
> We've attempted to send event notifications to this endpoint **54 times since the first
> failure on July 7, 2026 at 5:56:55 AM UTC** … **54 requests had other errors** while sending
> the webhook event. … We will stop sending event notifications to this webhook endpoint by
> **July 16, 2026 at 5:56:55 AM UTC**.

"Other errors" is Stripe's non-HTTP-status bucket (redirects, TLS, connect, response-read
errors) — NOT 4xx/5xx responses, which they report separately.

## Evidence gathered (all 2026-07-09)

1. **Endpoint is healthy from the public internet.** `POST https://frege.dev/api/v1/billing/webhook`
   returns fast 400s for bad/missing signatures (0.4–0.9s), including with Stripe's exact client
   shape (HTTP/1.1, `User-Agent: Stripe/1.0`, 20KB JSON body). TLS fine. DNS is A-only
   (216.150.1.193 / 216.150.16.129 — Vercel), no AAAA, so no broken-IPv6 path.
2. **Prod runtime HAS the Stripe secrets.** The route returns 503 `billing_unavailable` if
   `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are unset — we get 400, so both are present.
   (They read as empty via `vercel env pull` only because they're Sensitive-type.)
3. **Vercel firewall is not the cause**: Firewall "Not configured", Attack Mode off, no IP blocks.
4. **The `stripe_webhook_events` ledger in prod is EMPTY.** Every delivery that passes signature
   verification writes a ledger row first (`lib/core/billing-webhook-core.ts` beginWebhookEvent) —
   zero rows means **no live event has ever been processed** since the ledger shipped (2026-06-23).
5. **Timeline explains "first failure July 7 05:56 UTC"**: self-serve signup + checkout went live
   the evening of 2026-07-06 PDT (commits d516493/a3b3acd). The failures likely started with the
   first-ever live event burst (a new checkout and/or renewal invoices for the one existing June
   subscription) — i.e., this endpoint has plausibly **never delivered successfully**, and July 7
   is just when traffic began.
6. **`www.frege.dev` 308-redirects to the apex.** Stripe does not follow redirects and buckets
   them under "other errors". If the endpoint URL configured in the Frege Stripe account has
   `www.` (or `http://`), that alone produces exactly this failure signature: 100% of attempts
   failing, zero function invocations, healthy endpoint on direct probes. Unverifiable from this
   machine (see 7) — the notice prints the URL without www, but verify the configured value.
7. **Investigation boundary**: the local Stripe CLI is authed only to the *Laurelin* account
   (`acct_1SMojiHusNp8E6pI`, whose two webhook endpoints are laurelin-inc.com and the
   laurelin-chat backend — neither is frege.dev). Frege runs its own Stripe account, and its
   secret key is not readable from Vercel (Sensitive). Final confirmation requires the Frege
   Stripe dashboard or `stripe login` to the Frege account.

## Business impact assessment (prod DB, 2026-07-09)

- Orgs: 7 active / 6 inactive. `org_billing`: 6 rows, exactly **1** with stripe_customer_id +
  subscription (the June subscription; predates the ledger). `signups.paid_at` set: **1**.
- 4 new signups on 2026-07-07 + 1 on 07-06. **If any of them completed Stripe checkout, their
  payment succeeded but their org was never activated** (activation happens in this webhook).
  Must be checked in the Stripe dashboard: Payments / Checkout sessions since 2026-07-06.
- The June subscription's renewal invoices (if that's what the 54 events are) auto-charge fine;
  only our bookkeeping (last_event, period end, seats) is stale. Idempotent replay will heal it.

## Fix plan (Joe: ~5 minutes in the Frege Stripe dashboard)

1. **Read the exact error** (30s, tells us the class for certain): Workbench → Webhooks →
   `https://frege.dev/api/v1/billing/webhook` → open any failed attempt → the error string
   (e.g. "Redirect", "Timed out", "TLS error", "Could not connect").
2. **Check the configured URL for `www.`/`http://`** — if present, that's the root cause; edit to
   exactly `https://frege.dev/api/v1/billing/webhook`.
3. If the URL is already exact: **recreate cleanly** — add a new endpoint with that URL, enabled
   events at least: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted` (these are what
   `lib/core/billing-webhook-core.ts:295-334` dispatches). Copy the new signing secret →
   `vercel env rm STRIPE_WEBHOOK_SECRET production && vercel env add ...` → redeploy → delete the
   old endpoint. (A fresh secret also cures any signature-mismatch class in one move.)
4. **Replay**: dashboard → the failed events → Resend (all 54, oldest first). Our handler is
   idempotent with out-of-order protection, so replays are safe.
5. **Verify** (Claude can do this part): `stripe_webhook_events` ledger gains rows with
   status=processed; any paid-but-inactive org flips active; `signups.paid_at` updates.
6. **Fulfillment audit**: Payments since 2026-07-06 → for each succeeded checkout, confirm the
   org is active after replay; email the customer an apology/confirmation if their activation
   was delayed.

Alternative to 1–4 if preferred: run `stripe login` for the **Frege** account on this machine and
tell Claude — everything except reading the dashboard's per-attempt error text can then be done
from the CLI (`stripe webhook_endpoints list/update --live`, `stripe events resend --live`).

## Hardening follow-ups (after the fire is out)

- Alert on webhook silence: the usage-rollup or agent-worker cron should warn when
  `stripe_webhook_events` has no new rows for N days while `org_billing` has live subscriptions
  (this exact failure was invisible for 2+ days; only Stripe's courtesy email surfaced it).
- Add `docs/DEMO_OPERATOR_CHECKLIST.md` item: verify a `stripe trigger`/test event round-trips to
  the ledger after any Stripe or domain config change.
- The stale-`processing` recovery shipped 2026-07-09 protects against handler crashes, but
  nothing guards against config-level delivery failure — the alert above is that guard.
