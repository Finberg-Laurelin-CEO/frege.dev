# Frege.dev — build handoff

_Last updated: 2026-06-08. Written for the orchestrator picking up backend + email work._

## TL;DR — what's done

The static Frege site is now a **Next.js 15 App Router app, merged to `main`, and live in
production** at **https://frege.dev** (canonical; `www.frege.dev` 308-redirects to it).
Vercel project: **`laurelin-inc/frege-dev`**, deploying from `main`.

The **signup form and API are built and deployed but dormant** — they need a Postgres
`DATABASE_URL` to function. Everything else (landing page, privacy, terms, thanks) works.

---

## Live state (verified)

| Item | Status |
|---|---|
| Production URL | https://frege.dev → **200** (canonical, valid Let's Encrypt cert) |
| `www.frege.dev` | **308 → https://frege.dev/** |
| Vercel project | `laurelin-inc/frege-dev` (`prj_Ftph5PN6ooULwvpm0ANTCInn2i32`) |
| Deploy source | local `vercel --prod` from `main`; **git auto-deploy NOT yet connected** |
| Domain/DNS | `frege.dev` registered + nameserved by Vercel (`ns1/ns2.vercel-dns.com`); fully managed in Vercel, no external registrar |
| Next.js | `15.5.19` (bumped from 15.1.4 — Vercel rejected the old one as vulnerable) |
| `/` `/privacy` `/terms` `/thanks` `/signup` | all **200** |
| `/api/signup` | deployed, returns `{"error":"internal"}` because **no `DATABASE_URL` yet** (validation + honeypot + timing all work; only the DB insert fails) |

---

## Git / branch map

Default branch: **`main`** (remote HEAD, production source). All 8 branches are on
`github.com/Finberg-Laurelin-CEO/frege.dev`.

| Branch | What's in it | On remote |
|---|---|---|
| **`main`** | **The live app.** Next.js port + dormant signup form/API/schema. | ✓ |
| `feature/nextjs-app` | Source of the merged PR #1 (= what's now in main). | ✓ |
| `plan/product-build` | Product build-phase planning notes. | ✓ |
| `feature/landing-page` | Earlier static landing-page work (superseded by the Next.js port). | ✓ |
| `feature/signup-form` | Scoped/empty signup-form feature branch (planning stub). | ✓ |
| `plan/public-language` | Public-facing copy/positioning plan. | ✓ |
| `plan/signup-data-pathways` | **Signup data pathways spec** (schema, scoring, spam rules). | ✓ |
| `plan/website-design` | Website design plan (terminal aesthetic, form UX). | ✓ |

PR **#1** (`feature/nextjs-app` → `main`) is **MERGED**.

Plan/spec docs also live locally in `private-plans/` (gitignored) and in the superset
worktrees under `/Users/Joe/.superset/worktrees/1711fffb-.../`.

---

## What's still TODO

### 1. Backend: wire Postgres (the form is built, just needs a DB)
Code already in `main`:
- `lib/signup-schema.ts` — shared Zod schema (client + server).
- `app/signup/page.tsx` — 3-section form, blur validation, error summary,
  disabled-until-valid, honeypot (`company_url`) + `started_at` dwell check.
- `app/api/signup/route.ts` — Node runtime; validates, silently drops honeypot/fast
  submits, day-salted IP hash, **Neon tagged-template insert**, 409 on duplicate email.
- `db/001_signups.sql` — the `signups` table + unique index on `lower(work_email)`.
  Includes `other_tool`, `willing_to_pay`, and `other_comments` columns (added when
  the survey was extended). If a DB was already created from an older version of this
  file, add the missing columns before inserting.
- `scripts/migrate.mjs` — psql-free migration runner (psql isn't installed locally).

Steps to activate:
1. **Provision Neon** via Vercel Marketplace on the `frege-dev` project (Vercel dashboard →
   Storage → Neon Postgres, or `vercel:marketplace`). This auto-injects `DATABASE_URL`
   into Production/Preview/Development. _Needs a human browser click to confirm install._
2. `vercel env pull .env.local` (from repo root) to get `DATABASE_URL` locally.
3. Run the migration: `node --env-file=.env.local scripts/migrate.mjs db/001_signups.sql`.
4. **Redeploy** so the running app picks up `DATABASE_URL` (push to `main`, or
   `vercel --prod`). Then a real `/signup` submission returns `{ id }` and inserts a row.
5. (Optional) set `IP_HASH_SALT` env var for the IP hash (defaults to a constant otherwise).

Acceptance: POST `/api/signup` with a valid body returns `{"id": "<uuid>"}`; honeypot or
`started_at` < 3s old returns `{"id": null}`; duplicate email returns 409.

### 2. Connect git auto-deploy (recommended)
Right now production is deployed via CLI from local. Connect the GitHub repo to the
`frege-dev` project (Vercel dashboard → Project → Settings → Git, or `vercel git connect`)
with **Production Branch = `main`** so every push to `main` auto-deploys. _May need the
GitHub-app authorization click._

### 3. Email: frege.dev → Laurelin inbox + send-as alias (NOT started — Admin Console work)
This is **all Google Workspace Admin Console** work; no connected MCP/CLI can do it
(the Google MCPs are end-user scoped). Since `frege.dev` DNS is **managed inside Vercel**,
the MX/TXT/SPF/DKIM/DMARC records get added in the **Vercel DNS zone**
(`vercel dns add frege.dev ...`), while the mailbox/routing/alias config is done in the
Google Admin Console. Required steps:
1. **Add `frege.dev` to Google Workspace** (Admin Console → Account → Domains → Add domain).
   Google gives a **TXT verification record** → add it via `vercel dns add frege.dev @ TXT "<value>"`.
2. **MX records** so Google accepts mail for `*@frege.dev`: add Google's MX hosts
   (`aspmx.l.google.com` etc.) via `vercel dns add frege.dev @ MX "<host>" <priority>`.
   ⚠️ MX records coexist fine with the existing ALIAS web records — no conflict.
3. **Route mail** for `hello@frege.dev` (and/or catch-all) to the Laurelin inbox
   (Admin Console → Apps → Gmail → Routing, or add it as an alias/group).
4. **SPF / DKIM / DMARC** TXT records in the Vercel zone so outbound passes auth
   (SPF `include:_spf.google.com`; DKIM from Admin Console → Gmail → Authenticate email;
   DMARC `_dmarc` TXT).
5. **Send-as alias**: in `joseph.finberg@laurelin-inc.com`'s Gmail → Settings → Accounts →
   "Send mail as" → add `hello@frege.dev`, verify. Lets Joe send _as_ frege.dev.

### 4. Nice-to-haves (deferred, see plan branches)
- Lead scoring + `score`/`score_band` columns (see `plan/signup-data-pathways`).
- Rate limiting per IP/email (currently only honeypot + dwell-time).
- Operator dashboard / CSV export for hot leads.

---

## Key facts / gotchas for the next agent
- **Do NOT edit `public/styles.css` or `public/nav.js`** — hard constraint; they were moved
  verbatim from the old static site. Form-specific CSS lives in `app/signup/signup.css`.
- Next.js must stay on a **security-patched version** (≥ 15.5.19 on the 15 line) or Vercel's
  deploy gate rejects it.
- `psql` is **not installed** locally — use `scripts/migrate.mjs` for migrations.
- The `frege.dev` DNS zone is **inside Vercel** — use `vercel dns ...` (token is in the CLI
  auth file) for any email/verification records, not an external registrar.
- Vercel team scope: `laurelin-inc` (`team_2CyrGwIREIdmimRizYsJEhPc`).
