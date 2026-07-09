# Backend Architecture Note — Storage, Linking, Payment → API Keys

Last updated: 2026-06-23

This note captures the current backend topology and the payment-to-access flow as
deployed today. It complements (does not replace):

- `docs/HOSTED_BRAIN_ARCHITECTURE.md` — the hosted SaaS / brain design.
- `docs/GBRAIN_TO_FREGE.md` — how the gbrain adapter pattern maps onto Frege.
- `docs/STRIPE_CHANGELOG.md` / `docs/STRIPE_SETUP.md` — Stripe specifics.

---

## 1. Where data lives (storage)

**Single database: Neon Postgres (serverless).**

- Connection layer: `lib/db.ts` → `getSql()` uses `@neondatabase/serverless` (`neon(DATABASE_URL)`).
  The client is memoized per process; every query goes through `getSql()`.
- All persistent state is in Postgres. There is **no separate object store, cache, or
  secondary DB** in the app path. Schema is managed by ordered SQL migrations in `db/`
  (`001_*` … `011_*`), applied in sequence.
- Connection env vars come in two shapes (both point at the same Neon project):
  - `DATABASE_URL` / `DATABASE_URL_UNPOOLED` (used by the app via `lib/db.ts`).
  - `POSTGRES_*` and `PG*` mirrors (Neon/Vercel integration conventions).

### Core tables (by domain)

- **Tenancy & identity:** `organizations`, `users`, `organization_memberships`,
  `organization_invites`, `roles` (per-org capability flags), `api_keys`.
- **Brain / knowledge:** `brain_sources`, hosted brain pages, agent sessions, memory
  proposals (see migrations `003`, `004`, `006`).
- **Runtime & telemetry:** `agent_runs`, `telemetry_events`, `audit_events`,
  context/telemetry tables (`005`, `009`, `010`).
- **Billing & usage:** `org_billing` (one subscription per org), `usage_daily`
  (daily rollup; `actor_user_id NULL` = whole-org aggregate) (`011`).

### Org lifecycle

`organizations.status ∈ { inactive, active, suspended }`.
- New orgs default to **`inactive`** (pay-to-activate gate).
- Orgs that predated `011` were grandfathered to `active` so existing agents kept working.

---

## 2. System linking (how the pieces connect)

### Deployment topology (Vercel)

Two Vercel projects, **same Git repo** (`Finberg-Laurelin-CEO/frege.dev`, branch `main`),
**same Neon database**:

| Project | Purpose | URL | Protection |
|---|---|---|---|
| `frege-dev` | Public app + API + MCP surface | `https://frege.dev` | App auth only |
| `frege-admin` | Internal platform/admin console | `frege-admin-laurelin-inc.vercel.app` | Vercel SSO (team-only) **+** app staff gate |

- Both deploy the same code from `main`. They are differentiated only by **env vars**
  and **deployment protection**.
- `frege-admin` exists to put the `/platform` staff console behind a second wall
  (Vercel Authentication / team SSO) in addition to the app-level
  `requirePlatformStaffPage` gate. Defense-in-depth.
- **Cron caution:** crons are defined in repo `vercel.json`. They must run on **one**
  project only (the main site) to avoid double-processing the shared DB. Verify crons
  are disabled/ignored on `frege-admin`.

### External services

- **Stripe** — subscription billing. Webhook → `POST /api/v1/billing/webhook`.
  - The webhook endpoint is **singular** and points only at `https://frege.dev`.
    `frege-admin` must NOT register a second webhook (would double-process the same DB).
- **Neon Auth** — `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL` (auth integration).
- **Hermes** — inbound webhook secret `HERMES_FREGE_WEBHOOK_SECRET`.
- **Cron secret** — `CRON_SECRET` guards scheduled routes (`/api/cron/*`).

### gbrain relationship

Frege is **not** gbrain, but borrows gbrain's **adapter contract**: agents talk to a
brain adapter; the adapter decides what is real/synthetic/indexed/writable/approval-gated.
Frege adds org tenancy, per-user API-key actors, role/trust-zone gates, and telemetry on
every operation. See `docs/GBRAIN_TO_FREGE.md` for the operation-by-operation mapping
(`status`, `listSources`, `search`, `getPage`, `writePage`, `sync`, …).

---

## 3. Payment → API key (the actual flow)

**Important clarification:** payment does **not auto-generate** an API key. Payment
**activates the org**, which **unlocks** API-key access. Keys are minted separately by an
org admin. The link between the two is the org `status` gate.

### Step by step

1. **Checkout.** `POST /api/v1/billing/checkout` (org owner/admin only) creates a Stripe
   Checkout session for the selected plan/seats, records intended plan in `org_billing`,
   and returns `checkout_url`.
2. **Payment completes.** Stripe fires `checkout.session.completed` /
   `customer.subscription.*` → `POST /api/v1/billing/webhook`.
3. **Activation.** The webhook calls `activateOrg(orgId, …)`, which:
   - upserts `org_billing` (customer id, subscription id, status, period end, seats), and
   - sets `organizations.status = 'active'` (and `activated_at`).
   - `customer.subscription.deleted` / failed payment → org suspended.
4. **Key issuance (separate, admin-driven).** `POST /api/v1/admin/api-keys` calls
   `generateApiKey()` (`lib/core/keys.ts`) and inserts a row into `api_keys`.
   - Key format: `frg_live_<prefix>_<secret>`.
   - Storage: only `key_prefix` + `key_hash` are stored. `key_hash = sha256(rawKey | FREGE_API_KEY_SALT)`.
     The raw key is shown **once** at creation and never persisted.
5. **Key usage is gated by activation.** On each request, `lib/core/auth.ts` resolves
   the key by prefix, timing-safe compares the hash, checks key `status`/expiry, then
   `assertActiveOrg(auth)` returns **403 `org_inactive`** unless `org.status === 'active'`.

### Net effect

- A key can exist before payment, but **agent/data/cost routes reject it** until the org is
  active (i.e., until checkout's webhook lands). "Pay to use the API" is enforced by the
  org-status gate, not by tying key creation to a payment event.
- Secrets involved: `FREGE_API_KEY_SALT` (key hashing), `STRIPE_WEBHOOK_SECRET`
  (webhook signature verification), `STRIPE_SECRET_KEY` (checkout/portal API calls).

---

## 4. Open items / cautions

- **Two Stripe accounts in play.** Production (`frege.dev`) and the admin project may point
  at different Stripe accounts/keys. Confirm intended mode per project before relying on
  the admin console's billing views (it shows whatever account its key belongs to).
- **payouts_enabled.** Live charges can be enabled while payouts are still pending bank
  verification on Stripe's side; funds accrue until payouts are enabled.
- **Single webhook + single cron owner.** Keep both on the main project only.
- **Secret hygiene.** `FREGE_*` app secrets and Stripe keys are the crown jewels. If any are
  ever exposed (e.g. pasted into a chat/transcript), rotate them.
