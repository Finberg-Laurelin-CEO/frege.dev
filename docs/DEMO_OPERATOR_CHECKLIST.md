# Demo Operator Checklist — Investor Loom Recording Day

_Last updated: 2026-07-09. Companion to `docs/LOOM_INVESTOR_DEMO_SCRIPT.md`._

Run through this list before pressing record. Everything here is operator work
against the live `frege-local` org and the production Vercel projects — none of it
belongs on camera.

## 1. Email must actually send

Email verification and signup onboarding gate on Resend. When `RESEND_API_KEY` is
unset, sends become logged no-ops (`lib/core/email.ts`) — signup appears to work but
no verification email ever arrives.

```bash
vercel env ls --scope laurelin-inc   # confirm RESEND_API_KEY exists in Production
```

Confirm `RESEND_API_KEY` is set for Production on the `frege-dev` project.

## 2. Crons on exactly one project

`CRON_ENABLED=true` must be set on the cron-bearing project (`frege-dev`) **only**.
Both projects deploy the same `vercel.json`, so Vercel registers the crons on both;
the guard in `lib/cron-guard.ts` makes the other project no-op. If `CRON_ENABLED`
is set on both, the shared DB gets double-processed.

```bash
vercel env ls --scope laurelin-inc   # CRON_ENABLED=true on frege-dev only
```

## 3. Agent-worker cron is running

`/api/cron/agent-worker` should fire every minute (see `vercel.json`) and record
each pass in `cron_runs`. Check either:

- Vercel dashboard → `frege-dev` → Cron Jobs → recent invocations of
  `/api/cron/agent-worker` returning 200, or
- the `cron_runs` table (rows with `job = 'agent-worker'`, recent `started_at`,
  `ok = true`).

If passes return `{"skipped":"crons_disabled_on_this_project"}`, `CRON_ENABLED` is
missing on the project (see item 2).

## 4. CLI connection

```bash
frege doctor
```

Expected: `org: frege-local`, `orgStatus: active`, `role: admin`,
`key: c02d8a99ee7a`. Doctor exits nonzero if the org is not active.

Identity note: sign into the browser console as `joe@frege.dev` (on-screen
identity). The bootstrap admin `joe@laurelin-inc.com` is the platform-staff
operator account — keep it off screen. Verify `joe@frege.dev` is an admin member
of `frege-local` before recording; invite it from `/admin` if not.

## 5. Manifest sync is clean

```bash
frege docs sync frege.docs.yml --dry-run
```

Expected: 12 planned documents (including `demo-operator-checklist`), including
the two restricted entries (`security-provider-key-handling`,
`security-red-zone-handling`), and no errors.

## 6. Red-zone docs are imported

The denied-read beat needs restricted docs in the live org. Two ways to get them
there (do either, off camera):

Option A — sync the manifest once with the admin demo key (its role carries the
`restricted` label; a green-only key gets `403 forbidden_sensitivity` on the
restricted entries and the sync aborts):

```bash
frege docs sync frege.docs.yml
```

Option B — direct DB import into the live org:

```bash
vercel pull --yes --environment=production --scope laurelin-inc
node --env-file=./.vercel/.env.production.local \
  scripts/prototype/import-markdown-dir.mjs frege-local demo-data/frege-demo-docs/red restricted published
node --env-file=./.vercel/.env.production.local \
  scripts/prototype/index-semantic-map.mjs frege-local
rm -rf .vercel
```

## 7. Green-only writer key for the denial beat — **JOE ONLY, ~60 seconds**

> This is the one staging item nobody else (human or agent) can do for you — it
> requires holding a raw key that shouldn't leave your hands. Everything else on
> this checklist was pre-verified on 2026-07-09; this is the last gate before
> pressing record.

The admin demo key holds the `restricted` label, so **the denial beat will not fire
with it** — the on-camera denial must run through a writer-role key whose labels are
`public,internal` only. Create it in the console (connect → API keys) and export it
in a hidden prompt before recording:

```bash
export FREGE_WRITER_KEY=frg_live_...   # never on screen
```

Sanity check off camera — expect `not_found` and a nonzero `denied_count`:

```bash
FREGE_API_KEY="$FREGE_WRITER_KEY" frege docs read security-provider-key-handling
FREGE_API_KEY="$FREGE_WRITER_KEY" frege context "provider key handling"
```

## 8. Key hygiene

- Never show a raw `frg_live_` key on screen. The demo key prefix `c02d8a99ee7a`
  is safe to show; the raw key is not.
- **If any raw key appears on screen during recording, rotate it immediately after**
  (console → connect → revoke + re-create; or
  `node --env-file=... scripts/prototype/revoke-api-key.mjs c02d8a99ee7a`).
- Keep `~/.frege/mcp/config.json` and shell history out of frame.

## 9. Env vars from parallel branches (only if those branches have merged)

These are referenced by work on parallel feature branches and are **not** used by
code on this branch. Set them only if the corresponding branches have merged before
recording day; otherwise skip:

```text
FREGE_OAUTH_GOOGLE_CLIENT_ID / FREGE_OAUTH_GOOGLE_CLIENT_SECRET   (Google SSO)
FREGE_OAUTH_GITHUB_CLIENT_ID / FREGE_OAUTH_GITHUB_CLIENT_SECRET   (GitHub SSO)
FREGE_LEAD_ALERT_EMAIL                                            (lead alerts)
FREGE_SUPPORT_NOTIFY_EMAIL                                        (support notifications)
```

## 10. Final screen setup

- Browser left (`https://brain.frege.dev/console`, signed in as `joe@frege.dev`),
  terminal right in `/Users/Joe/frege/frege.dev`.
- `git status --short --branch` clean.
- Follow `docs/LOOM_INVESTOR_DEMO_SCRIPT.md` for the recording flow itself.
