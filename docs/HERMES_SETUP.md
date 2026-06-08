# Hermes Setup Brief — Frege.dev Signup Monitoring

> **For:** the Hermes agent (Nous Research) running on Joe's VPS.
> **Companion doc:** `docs/HERMES.md` — the monitoring *policy* (what to watch,
> what to alert on, notification tiers). This document is the *infrastructure*
> brief: what Frege is, where everything lives, what credentials you need,
> how to wire yourself up.
> **Author:** Mastra Code, handing off to Hermes + Joe.
> **Last verified:** 2026-06-08.

---

## 1. What you (Hermes) are being asked to do

Joe runs **frege.dev**, an early-access landing site for a B2B product. He
just shipped the signup form and database. He wants **you** to be the
monitoring + notification layer for new signups — replacing what would
normally be a Resend/cron pipeline.

Concretely, your job is:

1. **Poll** the production Postgres database on a cadence (recommended: every
   5 minutes).
2. **Notice** new signup rows.
3. **Judge** each one against the policy in `docs/HERMES.md` — most signups
   are routine, some are high-signal leads that warrant an immediate ping.
4. **Notify** Joe in his Discord channel(s), with three tiers of urgency
   (immediate / hourly / daily digest).
5. **Answer** ad hoc questions Joe sends you in Telegram or Discord: "what
   were yesterday's signups?", "how many people mentioned competitor X?",
   "show me everyone from companies >200 people," etc.

Read `docs/HERMES.md` for the exact alerting policy. This document covers
*how to plug in*.

---

## 2. What Frege is (context you'll need to make good judgments)

**Frege** is the early-access product at `frege.dev`. One-liner:

> _The semantic brain for your company: a secure, permission-aware knowledge
> layer that gives AI agents the right institutional context with version
> history and audit logs._

**The problem Frege solves:** Companies have institutional knowledge
scattered across docs, Slack, Confluence, code repos, tickets, etc. When AI
coding agents (Codex, Claude Code, Cursor, internal agents) work on tasks
inside those companies, they don't see that knowledge — so they hallucinate,
miss context, or do the wrong thing. Frege is a unified knowledge layer those
agents plug into so they have the company's real context, with proper
permissions and audit trail.

**Why this context matters to you, Hermes:** the people signing up are
people whose AI agents need company context. They're warm leads for a B2B
SaaS pre-launch. They're CTOs, eng managers, founders, AI/ML leads. The
signal per signup is high. Joe wants you to be opinionated about which ones
deserve an interrupt vs. which are just digest material.

**Meta:** You monitoring Frege's signups is itself a small demo of the
Frege thesis — an agent acting on company institutional data. Joe will
probably tell that story to investors. Keep that in mind: doing this job
well is itself the product pitch.

---

## 3. System architecture

```
┌────────────────────┐       POST /api/signup        ┌──────────────────────┐
│  frege.dev/signup  │ ────────────────────────────▶ │ Vercel serverless fn │
│  (Next.js form)    │                                │  (Node runtime)      │
└────────────────────┘                                └──────────┬───────────┘
                                                                 │
                                                                 │ INSERT
                                                                 ▼
                                                       ┌──────────────────┐
                                                       │  Neon Postgres   │
                                                       │  (us-east-1)     │
                                                       │  table: signups  │
                                                       └─────────┬────────┘
                                                                 │
                                       SELECT (every 5 min)      │
                                                                 ▼
                                                       ┌──────────────────┐
                                                       │  YOU (Hermes)    │
                                                       │  on Joe's VPS    │
                                                       └─────────┬────────┘
                                                                 │
                                               Discord webhook   │
                                                                 ▼
                                                       ┌──────────────────┐
                                                       │ Joe's Discord    │
                                                       │ #frege-signups   │
                                                       └──────────────────┘
```

### Components

| Component | What it is | Where it lives | Who manages it |
|---|---|---|---|
| **Landing site** | Next.js 15 app, hosted on Vercel | https://frege.dev | Joe (auto-deploys from `main`) |
| **Signup API** | `POST /api/signup` — serverless Node fn | Same Vercel project | Joe |
| **Database** | Neon Postgres, free tier | Provisioned via Vercel Marketplace, scoped to the `frege-dev` Vercel project | Joe |
| **Source repo** | Next.js code + this doc | https://github.com/Finberg-Laurelin-CEO/frege.dev | Joe |
| **You** | Nous Research Hermes agent | Joe's VPS | Joe |
| **Notifications** | Discord channel | Joe's Discord server | Joe |

### Why this shape

- **Serverless API + managed Postgres** so there's nothing for Joe to keep
  alive on the web tier.
- **No cron, no Resend, no email layer.** That's deliberate — you replace
  all of it. The original plan included a Vercel cron + Resend; we ripped
  it out before shipping because Hermes is a better fit (judgment, not just
  templated email).
- **You run on Joe's VPS** because (a) the VPS is already paid for, (b) you
  can poll on whatever schedule you like without cold-start cost, and (c)
  Joe wants you to also be a chat companion he can DM ad hoc — which
  requires you to be persistently available, not event-triggered.

---

## 4. What's in the Postgres database

Database name: `neondb` (Neon default). Schema: `public`. One application
table: `signups`.

### `signups` table schema

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `created_at` | `timestamptz` | Server time. **Use this as your watermark.** |
| `ip_hash` | `text` | SHA-256 of `IP \| day \| salt`. Day-rotating, so you can spot same-day duplicates from one IP but cannot deanonymize across days. **Do not surface in notifications.** |
| `user_agent` | `text` | Raw UA. Internal anomaly-detection only. **Do not surface in notifications.** |
| `name` | `text` | Submitter's name. |
| `work_email` | `text` | Lowercased. Domain = `split_part(work_email, '@', 2)`. |
| `company` | `text` | Self-reported. |
| `role` | `text` | Self-reported (e.g. "CTO"). |
| `company_size` | `text` | One of: `1-10`, `11-50`, `51-200`, `201-1000`, `1000+`. |
| `expected_users` | `integer` | Seats they expect to need. |
| `current_agent_tools` | `text[]` | Tools they use today (enum, see below). |
| `other_tool` | `text` | Free text when "Other" selected. |
| `monthly_ai_spend` | `text` | Bucket (enum, see below). |
| `willing_to_pay` | `text` | **Highest-signal pricing field.** Bucket. |
| `decision_timeline` | `text` | One of: `Now`, `30 days`, `90 days`, `Researching`. |
| `main_pain_point` | `text` | Free text, 10-1000 chars. **Highest-signal qualitative field.** |
| `other_comments` | `text` | Optional free text, ≤2000 chars. |
| `permission_to_contact` | `boolean` | Always `true` (form requires it). |

Indexes: `signups_pkey (id)`, `signups_email_lower_idx (lower(work_email))`.

### Enum values

These are the only valid values for the bucketed columns. Source of truth is
`lib/signup-schema.ts` in the repo — if this doc and the schema disagree,
the schema wins.

- `company_size`: `1-10` | `11-50` | `51-200` | `201-1000` | `1000+`
- `current_agent_tools` (array): `Codex` | `Claude Code` | `Cursor` |
  `OpenRouter` | `Internal agent` | `Hermes agent` | `OpenClaw` |
  `ChatGPT` | `Perplexity` | `Other MCP tools` | `We are evaluating` |
  `Other`
- `monthly_ai_spend`: `Under $500` | `$500-$2,000` | `$2,000-$10,000` |
  `$10,000+` | `Unknown`
- `willing_to_pay`: `Not sure yet` | `Under $100 / mo` | `$100-$500 / mo` |
  `$500-$2,000 / mo` | `$2,000-$10,000 / mo` | `$10,000+ / mo`
- `decision_timeline`: `Now` | `30 days` | `90 days` | `Researching`

### Anti-spam already applied before rows land

You can trust that every row in `signups` has passed:

1. **Honeypot** (`company_url` field). Bots fill every field; humans see a
   hidden one. Honeypot-positive submissions return 200 but are silently
   dropped — they never hit your table.
2. **Dwell-time check.** Submissions under 3 seconds after form load are
   silently dropped. Real humans don't fill 14 fields in <3s.
3. **Disposable-domain blocklist.** 42 domains (mailinator, yopmail, etc.)
   return a 400 to the user. Not inserted.
4. **MX-record lookup.** Domains with no MX record return 400. Domains
   with NXDOMAIN return 400. Domains where DNS timed out or returned
   SERVFAIL are *accepted* (fail-open, see §5).
5. **Unique index on `lower(work_email)`.** Duplicate signups return 409.

**Implication for your judgment:** every row in `signups` is a human who
passed real syntax + DNS checks, can plausibly receive email at the domain
they gave, and waited the polite amount of time. Treat each row as a
high-confidence lead. Filter your attention by the *fields* (pricing,
timeline, company size) — not by trying to re-detect spam.

---

## 5. The `source=timeout` audit trail (subtle but important)

The MX-record check **fails open** on DNS timeout / SERVFAIL — i.e. if the
resolver can't give a definitive answer in 5 seconds, the signup is
accepted. This is intentional: a flaky DNS resolver shouldn't ever block a
real prospect.

Cost: typos like `gmial.com` (which returns SERVFAIL, not NXDOMAIN) slip
through. To audit this, every signup logs a line like:

```
[email-validation] domain=acme.com   ok=true  source=mx
[email-validation] domain=foo.io     ok=true  source=a
[email-validation] domain=gmial.com  ok=true  source=timeout      ← weak
[email-validation] domain=fakedomain ok=false source=nxdomain
```

These logs are in **Vercel's logs**, not in Postgres. If you (Hermes) have
access to Vercel's log stream (see §6.4 below — optional), you can
cross-reference a signup row's `created_at` with the `[email-validation]`
line within ±1 second and flag rows where `source=timeout` as "weakly
verified — possible typo, worth a manual look before outreach."

If you don't have Vercel log access, skip this — it's a refinement, not a
blocker.

---

## 6. What Hermes needs from Joe (the credentials handoff)

Joe will create these and paste them into your config on the VPS. **Joe
will NOT hand his coding agent the credentials** — that's the right call.

### 6.1 Read-only Postgres role + connection string (required)

Joe runs this against the Neon DB (via the Neon SQL Editor at
console.neon.tech, or `psql $DATABASE_URL_UNPOOLED`):

```sql
-- 1. Create the role.
CREATE ROLE hermes_reader LOGIN PASSWORD '<generate a strong password>';

-- 2. Grant the minimum needed access.
GRANT CONNECT ON DATABASE neondb        TO hermes_reader;
GRANT USAGE   ON SCHEMA   public        TO hermes_reader;
GRANT SELECT  ON          signups       TO hermes_reader;

-- 3. Future-proof: any new tables in `public` should also be readable.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO hermes_reader;
```

Joe then constructs a connection string by taking the existing
`DATABASE_URL_UNPOOLED` from the Vercel project's env vars and replacing
the user + password with `hermes_reader:<that password>`. Looks like:

```
postgresql://hermes_reader:<PASSWORD>@<HOST>/neondb?sslmode=require
```

He pastes that into your VPS config as `DATABASE_URL` (or whatever env var
name you use for your DB tool).

**Why read-only?** Two reasons:
1. If you ever get prompt-injected via a malicious `main_pain_point`, you
   can't drop the table.
2. You shouldn't need to write — Joe will handle outreach personally. If
   you need state (e.g. last-seen watermark), see §6.2.

### 6.2 Watermark storage (recommended)

You need to remember "what's the most recent `created_at` I've already
seen?" so you don't re-alert on every poll.

**Easiest option:** use your existing Hermes state store on the VPS. Just
remember the ISO timestamp.

**If you don't have one,** Joe can create a small state table you're
allowed to write to:

```sql
-- Run as the default writable role, NOT as hermes_reader:
CREATE TABLE IF NOT EXISTS hermes_state (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON hermes_state TO hermes_reader;
```

Then you read/write:

```sql
-- Read the watermark
SELECT value FROM hermes_state WHERE key = 'signups_watermark';

-- Write it after a successful poll
INSERT INTO hermes_state (key, value, updated_at)
VALUES ('signups_watermark', '{"last_seen": "2026-06-08T09:00:58.113Z"}'::jsonb, now())
ON CONFLICT (key) DO UPDATE
  SET value = excluded.value, updated_at = now();
```

This is the **one** exception to "Hermes is read-only" — you can write your
own state table. If you have your own VPS-side state, use that instead.

### 6.3 Discord webhook URL(s) (required for notifications)

Joe wants signup alerts in a Discord channel. To get the webhook URL:

1. In Discord, right-click the target channel (e.g. `#frege-signups`)
2. Edit Channel → Integrations → Webhooks → New Webhook
3. Copy Webhook URL — looks like
   `https://discord.com/api/webhooks/<ID>/<TOKEN>`

He pastes this into your VPS config as e.g. `DISCORD_WEBHOOK_URL`.

If Joe wants different tiers to land in different channels (e.g. Tier 1 in
`#frege-leads-urgent`, Tier 3 daily digest in `#frege-signups-daily`), he
should create one webhook per channel and paste all of them.

To post to Discord, send a JSON `POST` to the webhook URL. Minimum payload:

```json
{ "content": "🚨 New Frege lead: Jane Smith @ Anthropic (CTO, willing $500-2k/mo, Now timeline)" }
```

For richer formatting (recommended for Tier 1 leads — embed the pain point
quote, link to a hypothetical CRM, etc.) use Discord's embed schema:

```json
{
  "embeds": [{
    "title": "🚨 New Frege lead",
    "color": 15158332,
    "fields": [
      { "name": "Name",     "value": "Jane Smith",            "inline": true },
      { "name": "Company",  "value": "Anthropic",             "inline": true },
      { "name": "Role",     "value": "CTO",                   "inline": true },
      { "name": "Size",     "value": "1000+",                 "inline": true },
      { "name": "Pays",     "value": "$2,000-$10,000 / mo",   "inline": true },
      { "name": "Timeline", "value": "Now",                   "inline": true },
      { "name": "Pain",     "value": "\"<main_pain_point quote, ≤200 chars>\"" }
    ],
    "footer": { "text": "Why flagged: enterprise size + high paid intent" }
  }]
}
```

### 6.4 Vercel log access (optional)

If Joe wants you to enrich signups with the `[email-validation]` audit
source (see §5), he can give you a **Vercel API token** with read access
to the `frege-dev` project's logs. This is optional and not required for
MVP.

### 6.5 Things Joe is **not** giving you

For your own safety + his:

- **No write access to `signups`.** If you ever feel like you need to
  modify a signup, ping Joe instead.
- **No SMTP / Resend credentials.** Joe will do outreach personally.
- **No GitHub access.** You don't need to touch the code.
- **No Vercel deploy permissions.** Same.

---

## 7. Polling pattern

Once you have `DATABASE_URL` and the Discord webhook URL, the loop is:

```
every 5 minutes:
  watermark = read 'signups_watermark' (or "1970-01-01" on first run)

  rows = SELECT * FROM signups
         WHERE created_at > $watermark
         ORDER BY created_at ASC

  for each row in rows:
    tier = classify(row)   # per docs/HERMES.md §4
    if tier == 1: post immediately to Discord (rich embed)
    if tier == 2: accumulate; flush at top of hour
    if tier == 3: accumulate; flush at 08:30 Pacific daily

  if rows: write 'signups_watermark' = max(rows.created_at)
```

A representative SQL query for the poll itself:

```sql
SELECT *
FROM signups
WHERE created_at > $1     -- the watermark
ORDER BY created_at ASC
LIMIT 100;                -- safety cap; in practice always tiny
```

See `docs/HERMES.md` §5 for more queries (high-signal filter, domain
cluster detector, daily-roll-up aggregates).

---

## 8. Sanity-test the wiring before going live

Once Joe pastes in the credentials, run this once to confirm everything
works:

```sql
-- Should succeed and return ≥ 0:
SELECT count(*) FROM signups;

-- Should FAIL with "permission denied" — proves read-only is enforced:
DELETE FROM signups WHERE work_email = 'never-existed@example.com';

-- Should return the watermark row (after first poll) or nothing (before):
SELECT * FROM hermes_state WHERE key = 'signups_watermark';
```

Then post a test message to Discord to confirm the webhook works:

```json
{ "content": "✅ Hermes wired up to Frege signup monitoring. Watermark initialized; polling every 5 min. Standing by." }
```

If all three work, you're live.

---

## 9. Recommended first-week behavior

- **Days 1-3:** Quiet mode. Don't actually send Tier 1 / Tier 2 alerts —
  just *log* the classification decision for each new row. Joe can review
  your decisions before they hit his Discord. This is calibration: the
  thresholds in `docs/HERMES.md` §4 are first-guess and probably wrong in
  ways that matter.
- **Day 3 onwards:** Switch on real alerts. Send the daily digest from
  day 1 — that's low-stakes.
- **End of week 1:** Send Joe a meta-report: "Here are the rules I
  applied, here are the alerts I would have sent, here's what I'd
  recommend tuning." He'll iterate the policy with you.

---

## 10. Open questions for Joe (not blockers)

- Do you want **separate Discord channels** for Tier 1 (urgent), Tier 2
  (cluster/pattern), Tier 3 (daily)? Or one channel with different
  emoji/threading conventions?
- Do you want Hermes to also **listen** in Discord for replies and
  follow-up questions, or is this a one-way push channel?
- After a week of real signups, do you want Hermes to also start
  **enriching** rows with Clearbit/Apollo/LinkedIn lookups, or keep it
  pure DB monitoring?
- Anything specific to recognize / score about competitors named in
  `main_pain_point`? (Glean, Notion AI, Sana, Cody, Sourcegraph, Copilot
  Workspace, etc.) Hermes should use its own world-knowledge but Joe
  might want to weight some names higher.

---

## 11. TL;DR for Hermes

> You're being plugged into a B2B SaaS pre-launch signup monitoring job.
> The product is **Frege** (semantic knowledge layer for company AI
> agents). The site is **frege.dev**. Signups land in a **Neon Postgres**
> database in a single table called `signups`. Joe will give you a
> **read-only connection string** (role: `hermes_reader`) and a **Discord
> webhook URL**. Poll every 5 minutes, classify each new row per
> `docs/HERMES.md`, post to Discord. Spend the first 3 days in
> calibration mode (log don't send). Never write to `signups`. Never
> auto-reply to signups. Be opinionated about which leads deserve an
> interrupt vs. which are digest material — Joe trusts your judgment more
> than any threshold list.
>
> Welcome to the team.
