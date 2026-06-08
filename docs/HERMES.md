# Hermes Monitoring Brief — Frege Early-Access Signups

> **For:** the Hermes agent that will monitor and act on signups to frege.dev.
> **Author:** Mastra Code (Claude), handing off to Joe + Hermes.
> **Date:** 2026-06-08.

---

## 1. What Frege is (so Hermes has context)

**Frege** is the early-access product behind `frege.dev`. The one-line pitch:

> _"The semantic brain for your company: a secure, permission-aware knowledge
> layer that gives AI agents the right institutional context with version
> history and audit logs."_

Translation: companies have institutional knowledge scattered across docs,
Slack, Confluence, code, etc. AI coding agents (Codex, Claude Code, Cursor,
internal agents) don't see it, so they hallucinate or do the wrong thing.
Frege is a knowledge layer those agents plug into so they have the company's
real context, permissions, and audit trail.

**Why this matters for Hermes:** signups to frege.dev are early-access requests
from people whose AI agents need company context. These are warm leads for a
B2B SaaS pre-launch. The signal in each signup is high. Joe wants to know
about them quickly, and wants a smart agent (not a dumb email digest) to
decide _which ones_ are worth interrupting him for.

This is also a **dogfooding opportunity**: Hermes monitoring the Frege signup
DB is itself an instance of "an agent acting on company institutional data."
Joe should be able to truthfully tell investors: _"We run our own pipeline on
our own product philosophy."_

---

## 2. What was built (the thing Hermes will watch)

The signup system is a Next.js app deployed on Vercel:

- **Form:** `https://frege.dev/signup` — public, 14-field early-access form.
- **API:** `POST /api/signup` — validates, dedupes, inserts into Postgres.
- **DB:** Neon Postgres, provisioned via Vercel Marketplace, free tier.
- **No email/cron/Resend** — Hermes replaces that layer.

### Anti-spam already done by the app (Hermes does NOT need to filter these)

| Layer | What it catches | Behavior |
|---|---|---|
| Honeypot (`company_url`) | Bots that fill every field | Silent 200 + `id: null`, no DB write |
| Dwell-time (<3s) | Bots that auto-submit instantly | Silent 200 + `id: null`, no DB write |
| Disposable-domain blocklist | `mailinator.com`, `yopmail.com`, etc. (42 domains) | 400 to the user, no DB write |
| MX lookup | Typos (`gmial.com`), made-up domains | 400 to the user, no DB write |
| Unique index on `lower(work_email)` | Duplicate signups | 409 to the user |

**Implication:** every row in the `signups` table is a human that passed real
syntax + DNS checks and could plausibly receive email at the domain they gave.
The noise is already filtered out. Hermes should treat each row as a
high-confidence lead.

---

## 3. Database access

### Connection

The Postgres DB lives on Neon, scoped to the Vercel project `frege-dev`.
The connection string Joe needs to give Hermes:

```
DATABASE_URL_UNPOOLED   # use this for long-running agent polling
DATABASE_URL            # pooled — fine for short-lived queries too
```

Both are in Vercel → `frege-dev` → Settings → Environment Variables. Joe can
also pull them locally with `vercel env pull .env.local`.

**Recommendation:** give Hermes the `DATABASE_URL_UNPOOLED` string and a
read-only Postgres role (see §6 below). It only needs to read.

### Schema — `signups` table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `created_at` | `timestamptz` | Server time. **Use this as the watermark.** |
| `ip_hash` | `text` | SHA-256 of `IP \| day \| salt`. Day-rotating, so cannot deanonymize across days. Use only to spot _same-day_ duplicates from the same IP. |
| `user_agent` | `text` | Raw UA string. Sometimes useful for spotting curl/bot patterns that beat the dwell check. |
| `name` | `text` | Submitter's name. |
| `work_email` | `text` | **Lowercased.** Email domain is in `split_part(work_email, '@', 2)`. |
| `company` | `text` | Self-reported. |
| `role` | `text` | Self-reported (e.g. "CTO", "Eng Manager", "Solo founder"). |
| `company_size` | `text` | One of: `1-10`, `11-50`, `51-200`, `201-1000`, `1000+`. |
| `expected_users` | `integer` | How many seats they expect to need. Self-reported. |
| `current_agent_tools` | `text[]` | What they use today. Values from a fixed enum (see §4). |
| `other_tool` | `text` | Free text, present when `Other` was selected. |
| `monthly_ai_spend` | `text` | One of: `Under $500`, `$500-$2,000`, `$2,000-$10,000`, `$10,000+`, `Unknown`. |
| `willing_to_pay` | `text` | One of: `Not sure yet`, `Under $100 / mo`, `$100-$500 / mo`, `$500-$2,000 / mo`, `$2,000-$10,000 / mo`, `$10,000+ / mo`. **Highest-signal field for prioritization.** |
| `decision_timeline` | `text` | One of: `Now`, `30 days`, `90 days`, `Researching`. |
| `main_pain_point` | `text` | Free text, 10-1000 chars. **Highest-signal field for qualitative judgment.** |
| `other_comments` | `text` | Free text, optional, up to 2000 chars. |
| `permission_to_contact` | `boolean` | Always `true` (the form requires it). |

Indexes: `signups_pkey (id)`, `signups_email_lower_idx (lower(work_email))`.

### Enum values (for filters / pattern-matching)

Values are defined in `lib/signup-schema.ts` — Hermes should consider that file
the source of truth if it ever drifts from this doc.

- `COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"]`
- `AGENT_TOOLS = ["Codex", "Claude Code", "Cursor", "OpenRouter", "Internal agent", "Hermes agent", "OpenClaw", "ChatGPT", "Perplexity", "Other MCP tools", "We are evaluating", "Other"]`
- `MONTHLY_AI_SPEND = ["Under $500", "$500-$2,000", "$2,000-$10,000", "$10,000+", "Unknown"]`
- `WILLING_TO_PAY = ["Not sure yet", "Under $100 / mo", "$100-$500 / mo", "$500-$2,000 / mo", "$2,000-$10,000 / mo", "$10,000+ / mo"]`
- `DECISION_TIMELINES = ["Now", "30 days", "90 days", "Researching"]`

---

## 4. What Joe wants Hermes to do

### 4.1 Default cadence

Poll `signups` every **5 minutes**. Track a watermark — the max `created_at`
already seen. On each poll, fetch rows newer than the watermark.

Joe is fine with a 5-minute "I might not get pinged for 5 min" delay. He does
not want a 24-hour digest.

### 4.2 Notifications — three tiers

Joe should receive **three distinct kinds of notification**, with different
urgency and channels:

#### Tier 1 — **High-signal lead** → notify immediately (push / iMessage)

Any one of these triggers a per-signup ping:

- `willing_to_pay` is `$500-$2,000 / mo` or higher
- `expected_users` ≥ 50
- `company_size` is `201-1000` or `1000+`
- `decision_timeline` is `Now`
- `current_agent_tools` contains `Internal agent` (sophisticated buyer)
- Email domain matches a known **Fortune 1000 / unicorn / AI lab** (Hermes
  should apply its own world-knowledge here — no fixed list. Examples:
  `@anthropic.com`, `@openai.com`, `@stripe.com`, `@google.com`, `@meta.com`,
  `@databricks.com`, `@scale.com`, etc.)
- `main_pain_point` mentions a specific competitor by name (e.g. Glean,
  Notion AI, Sana, GitHub Copilot Workspace, Cody, Sourcegraph). The exact
  list will evolve — Hermes should judge.

**Notification format Joe wants for Tier 1:**

```
🚨 Frege lead: {name} @ {company} ({work_email})
   Role: {role} · Size: {company_size} · Pays: {willing_to_pay}
   Tools: {current_agent_tools.join(", ")}
   Timeline: {decision_timeline}
   Pain: "{main_pain_point | trim to 200 chars}"
   Reason flagged: {hermes's 1-line explanation}
```

#### Tier 2 — **Cluster / pattern** → notify within the hour

Trigger:

- ≥3 signups from the **same email domain** within 24 hours → likely team
  trial. _Especially_ valuable signal.
- ≥10 signups in any 1-hour window → either viral moment or attack; either
  way Joe should know.
- A new `main_pain_point` theme emerges (e.g. ≥3 signups in a week mention
  the same word/phrase Hermes hadn't seen before).

**Notification format Joe wants for Tier 2:**

```
📊 Frege pattern: {one-line description}
   Examples: {2-3 representative rows}
   Suggested action: {hermes's recommendation}
```

#### Tier 3 — **Daily roll-up** → notify once a day, morning Pacific

Quiet summary of yesterday:

- Total new signups
- Breakdown by `company_size`, `willing_to_pay`, `decision_timeline`
- Top 3 most common tools in `current_agent_tools`
- Most interesting `main_pain_point` quotes (Hermes picks 2-3)
- Any Tier 1/2 alerts that were already sent (so Joe sees them in context)

### 4.3 Things Hermes should NOT do

- **Do not auto-reply to signups.** Joe will handle outreach personally for
  early access. The DB has `permission_to_contact = true` for legal cover,
  not for automated mass-email.
- **Do not write to the DB.** Read-only. If you spot bad data, ping Joe
  instead of mutating.
- **Do not include `ip_hash` or `user_agent` in notifications.** They're for
  internal anomaly detection only.
- **Do not surface raw email addresses in any place where logs persist
  beyond Joe's eyes** (Slack public channels, etc.).

### 4.4 Things Hermes can additionally search/index/learn

Suggested but optional, in priority order:

1. **Domain enrichment**: for each new signup, look up the company domain
   (Clearbit/Apollo/free heuristics) and attach industry, headcount, funding.
   Flag mismatches with self-reported `company_size` — useful tell.
2. **LinkedIn cross-reference**: search `{name} {company}` to confirm the
   submitter is who they say. Flag impostors / departed employees.
3. **Pain-point clustering**: maintain a rolling embedding cluster of
   `main_pain_point` text. When a new pain shows up that's >0.85 cosine
   similar to an existing cluster, attach the cluster id. Lets Joe see
   "this exact pain has now been mentioned 12 times" — strong product
   prioritization signal.
4. **Competitor mention tracking**: extract named competitors from
   `main_pain_point` and `other_comments`. Weekly trend report.
5. **Geographic distribution**: from `ip_hash`? No — that's a one-way hash.
   Skip this unless Hermes adds geo at ingest time later.

---

## 5. Suggested queries

Hermes can adapt these as needed. All are read-only.

### New signups since watermark

```sql
SELECT *
FROM signups
WHERE created_at > $1   -- last seen watermark
ORDER BY created_at ASC;
```

### High-signal lead check (Tier 1)

```sql
SELECT *
FROM signups
WHERE created_at > $1
  AND (
       willing_to_pay IN ('$500-$2,000 / mo', '$2,000-$10,000 / mo', '$10,000+ / mo')
    OR expected_users >= 50
    OR company_size IN ('201-1000', '1000+')
    OR decision_timeline = 'Now'
    OR 'Internal agent' = ANY(current_agent_tools)
  );
```

### Domain cluster (Tier 2)

```sql
SELECT
  split_part(work_email, '@', 2) AS domain,
  COUNT(*) AS n,
  MIN(created_at) AS first_seen,
  MAX(created_at) AS last_seen,
  array_agg(name) AS names
FROM signups
WHERE created_at > now() - interval '24 hours'
GROUP BY 1
HAVING COUNT(*) >= 3
ORDER BY n DESC;
```

### Daily roll-up (Tier 3)

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE willing_to_pay LIKE '$%')           AS paid_intent,
  COUNT(*) FILTER (WHERE decision_timeline = 'Now')          AS now_timeline,
  COUNT(*) FILTER (WHERE company_size IN ('201-1000','1000+'))  AS enterprise
FROM signups
WHERE created_at >= date_trunc('day', now() - interval '1 day')
  AND created_at <  date_trunc('day', now());
```

### Pain-point sample for roll-up

```sql
SELECT name, company, willing_to_pay, main_pain_point
FROM signups
WHERE created_at >= date_trunc('day', now() - interval '1 day')
  AND created_at <  date_trunc('day', now())
ORDER BY
  CASE willing_to_pay
    WHEN '$10,000+ / mo'        THEN 1
    WHEN '$2,000-$10,000 / mo'  THEN 2
    WHEN '$500-$2,000 / mo'     THEN 3
    WHEN '$100-$500 / mo'       THEN 4
    WHEN 'Under $100 / mo'      THEN 5
    ELSE 6
  END
LIMIT 5;
```

---

## 6. Security / access setup Joe should do

### 6.1 Create a read-only Postgres role for Hermes

Run this once against the Neon DB (Joe can do it via `psql` against
`DATABASE_URL_UNPOOLED`, or via the Neon SQL Editor in the browser):

```sql
CREATE ROLE hermes_reader LOGIN PASSWORD '<generate a strong one>';
GRANT CONNECT ON DATABASE neondb TO hermes_reader;
GRANT USAGE  ON SCHEMA public TO hermes_reader;
GRANT SELECT ON signups TO hermes_reader;
-- Future-proof: any new tables in `public` will also be readable.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO hermes_reader;
```

Then build a connection string for Hermes by replacing the user + password in
`DATABASE_URL_UNPOOLED` with `hermes_reader:<password>`.

**Why a separate role?** The default Vercel-provisioned role can write. Hermes
should not be able to corrupt the signup table even if it gets prompt-injected
by something in `main_pain_point`.

### 6.2 Don't put the connection string in chat

Joe should put the Hermes connection string into Hermes' own secrets store,
not paste it anywhere it'll persist.

### 6.3 Watermark storage

Hermes needs to remember the last-seen `created_at`. If Hermes already has
persistent state, just store it there. If not, the simplest option:

```sql
-- One-time setup (using the writable role, not hermes_reader):
CREATE TABLE IF NOT EXISTS hermes_state (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON hermes_state TO hermes_reader;
```

Then Hermes reads/writes `('signups_watermark', {"last_seen": "2026-06-08T..."})`.

This is the one exception to "Hermes is read-only" — it can write _its own_
state table. Joe: decide whether you want this in the same DB or in Hermes'
own store.

---

## 7. Notification channels — Joe's TODO

Joe still has to pick:

1. **Where do Tier 1 alerts go?** (iMessage to your phone? Signal? Slack DM
   to yourself? Telegram? Apple push via a shortcut?)
2. **Where do Tier 2 alerts go?** (Same as 1, or a separate "signal" channel?)
3. **Where does the Tier 3 daily go?** (Email to yourself? Notion page?
   Slack channel `#frege-signups`?)
4. **What time should the daily land?** Recommendation: 08:30 Pacific.

Whatever you pick, just give Hermes the webhook / API token for it. The agent
doesn't care which channel.

---

## 8. Open questions for Joe (not blockers)

- Do you want Hermes to also watch for **rejected** signups (disposable,
  no-MX)? Right now those are silently dropped by the API and never hit the
  DB. If you want to know about attempted bad-email signups, we'd need to add
  a `signup_rejections` table. Probably not worth it for MVP — flagging here.
- Do you want Hermes to **score** each lead (0-100) and only ping above some
  threshold? Easy to add once it's collecting data.
- After ~1-2 weeks of real signups, Joe should re-tune the Tier 1 criteria
  based on what's actually arriving. The current thresholds are guesses.

---

## 9. TL;DR for Hermes

> You watch the `signups` table in the Neon Postgres DB belonging to the
> Vercel project `frege-dev`. Every 5 minutes, fetch new rows. For each new
> row, decide if it's a high-signal lead (Tier 1) and ping Joe immediately
> if so. Also watch for domain clusters and traffic spikes (Tier 2). Once
> a day, send Joe a digest (Tier 3). Read-only DB access via the
> `hermes_reader` Postgres role. Never auto-reply to a signup. Use your own
> world-knowledge to recognize big-company domains, named competitors, and
> high-value pain-point patterns — the schema doesn't encode that.
