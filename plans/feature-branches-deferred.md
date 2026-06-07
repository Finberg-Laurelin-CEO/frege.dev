# Deferred Feature Branches

Branches called out in the README that we are *not* creating yet. The strategy
is to ship the landing page and signup form first, collect interest, and only
then invest in the backend that powers signups end to end.

These branches will be cut from `main` when the prior branch lands and the
Phase 0 sequencing in `plans/product-build.md` says it is time.

---

## feature/signup-api

**Cut after:** `feature/signup-form` is merged.

**Goal:** Replace the stub `/api/signup` endpoint with a real server-side
handler that validates, rate-limits, and accepts signups.

**Likely scope:**

- Real `/api/signup` route handler in Next.js.
- Server-side schema validation using the shared Zod schema from `feature/signup-form`.
- Honeypot enforcement (silent 200).
- Per-IP and per-email rate limiting per `plans/signup-data-pathways.md`.
- IP hashing with a daily-rotated salt from env.
- User-agent and referrer capture. UTM passthrough.
- Structured logging with PII redaction.
- Error responses matching the API contract in `plans/signup-data-pathways.md`.
- In-memory or KV-backed rate limit store (Postgres-backed limit lands with the database branch).

**Out of scope:** persistence to Postgres, lead scoring, notifications.

**Acceptance:** integration tests cover happy path, validation errors,
honeypot, rate limits, and duplicate email same-day.

---

## feature/signup-database

**Cut after:** `feature/signup-api` is merged.

**Goal:** Make Postgres the source of truth for signups.

**Likely scope:**

- Pick the migration tool (Drizzle, Prisma, or node-pg-migrate). Decision recorded as an ADR.
- `signups` table per the schema in `plans/signup-data-pathways.md`.
- Indexes including the `(email, day)` unique index.
- `DATABASE_URL` configuration. No vendor-specific code.
- Local dev via Docker Postgres. Preview/prod via the chosen managed Postgres.
- Replace the stub write path in the API with real inserts.
- Promote per-email daily limit to a DB-enforced unique constraint.
- Seed and reset scripts for local dev.
- CI runs migrations against an ephemeral Postgres before tests.

**Out of scope:** lead scoring, operator dashboard, analytics tables.

**Acceptance:** a successful POST creates a row visible via `psql`, with all
captured fields populated. Duplicate same-day submissions return 409.

---

## feature/lead-scoring

**Cut after:** `feature/signup-database` is merged.

**Goal:** Score every signup at write time and notify the team on hot leads.

**Likely scope:**

- `lib/lead-score.ts` implementing the weights in `plans/signup-data-pathways.md`.
- Score and band persisted on insert. Backfill script for existing rows.
- Notification on `hot` band: Slack webhook or transactional email to the founders.
- Minimal internal export endpoint or CLI for pulling recent hot leads. Auth-gated.
- Light operator README explaining how to triage and follow up.

**Out of scope:** full operator dashboard, CRM integrations, automated outreach.

**Acceptance:** test fixtures cover cold/warm/hot scoring, notification fires
on hot only, and the export tool returns the expected rows.

---

## Sequencing Recap

The order is intentional:

1. `feature/landing-page` — prove we can ship something credible.
2. `feature/signup-form` — collect intent with a fake backend.
3. *(checkpoint — do we have signups? if not, fix the form before adding backend.)*
4. `feature/signup-api` — real validation and abuse controls.
5. `feature/signup-database` — Postgres as source of truth.
6. `feature/lead-scoring` — turn signups into discovery calls.

Each branch is small and merges into `main` once its acceptance criteria are
met. No long-lived feature branches.
