# Governed Skills Compiler — Codex Orchestration Prompt & Plan

Date: 2026-07-22
Design rationale (read first): `/Users/Joe/frege/frege.dev/plans/2026-07-22-governed-skills-compiler-design.md`
This file is self-sufficient: it is both your prompt and your plan.

---

## §0 — YOUR ROLE (read this as your operating instructions)

You are Codex, running in `/Users/Joe/frege/frege.dev` (absolute repo root), currently
on branch `main`. **You are the agent orchestrator.** You do not hand this file to
someone else; you execute it:

1. You perform **Phase 0 (§2) yourself** on a new integration branch
   `feat/skills-compiler` (branched off `main`).
2. You then create **three git worktrees (§3)** and spawn **one subagent per worktree**,
   giving each subagent its brief verbatim from §3. Subagents work in parallel. Each
   owns a disjoint set of files — enforce this; reject subagent diffs that touch files
   outside their ownership list.
3. You **review and merge** subagent branches in the order A → B → C into
   `feat/skills-compiler` (§4), resolve conflicts, run the full test suite, and do the
   manual smoke test.
4. You open **ONE pull request**: `feat/skills-compiler` → `main`, linking
   `/Users/Joe/frege/frege.dev/plans/2026-07-22-governed-skills-compiler-design.md`
   in the PR body. Then you STOP and report.

**Hard guardrails (non-negotiable):**
- Every new route, MCP tool, and UI surface is gated behind the env flag
  `FREGE_SKILLS_COMPILER === "true"`. Flag off ⇒ feature invisible, zero behavior change.
- Never touch billing, Stripe webhook, Clerk/auth, or middleware host logic:
  do not modify `/Users/Joe/frege/frege.dev/app/api/v1/billing/**`,
  `/Users/Joe/frege/frege.dev/lib/core/billing-webhook-core.ts`,
  `/Users/Joe/frege/frege.dev/lib/core/clerk-config.ts`,
  `/Users/Joe/frege/frege.dev/middleware.ts`.
- Migrations must be idempotent (`create table if not exists`,
  `add column if not exists`) like every existing file in `/Users/Joe/frege/frege.dev/db/`.
- No new vendors, no OAuth apps, no external connectors, no model training.
- Vercel preview deploys are broken for this project. QA locally only
  (`pnpm dev`, `pnpm test`). **You never deploy. Joe deploys.**
- Compiled skills are NEVER canonical without a human accepting the proposal through
  the existing review flow. No auto-merge paths, no autonomous edits to approved skills.
- Follow repo conventions: dotted audit action names (`admin.skills.accept`),
  `FREGE_*` env vars read as `process.env.X === "true"`, 3-digit migration numbering.
- Use absolute paths exactly as written in this file; do not resolve paths relative to
  a worktree cwd when referring to the main checkout, and vice versa.

---

## §1 — REPO FACTS (verified 2026-07-22; trust these over assumptions)

Stack: Next.js 15 App Router, Neon Postgres via `getSql()` from `@/lib/db`, Zod,
node:test. Next migration number is **030** (latest is 029; 015 is intentionally absent).

**Governance rail (REUSE, do not rebuild):**
- Table `memory_proposals` — defined in
  `/Users/Joe/frege/frege.dev/db/006_hosted_brain_sessions.sql`, with
  `memory_proposals_type_chk` CHECK currently allowing
  `('page_create','page_update','source_create','link_update')`.
- Core functions in `/Users/Joe/frege/frege.dev/lib/core/brain.ts`:
  `createMemoryProposal` (~L606), `listMemoryProposalsForAdmin` (~L704),
  `resolveMemoryProposal` (~L911, the merge step — gates on
  `auth.capabilities.canReviewMemoryProposals`).
- Routes: create `/Users/Joe/frege/frege.dev/app/api/v1/brain/proposals/route.ts`;
  list `/Users/Joe/frege/frege.dev/app/api/v1/admin/brain/proposals/route.ts`;
  resolve `/Users/Joe/frege/frege.dev/app/api/v1/admin/brain/proposals/[id]/route.ts`
  (PATCH, body `z.enum(["accept","reject"])`, audits `admin.memory_proposals.<action>`).

**Artifact store (skills slot in here):**
- `brain_pages` + `brain_page_revisions` in
  `/Users/Joe/frege/frege.dev/db/006_hosted_brain_sessions.sql`; `brain_pages` has
  `frontmatter jsonb`, `trust_zone ('green'|'red')`, `tags[]`, `status`.

**Sessions (source material #1):**
- `brain_sessions` / `brain_session_events` (same db/006 file). Core:
  `startBrainSession` (~L420), `appendSessionEvent` (~L465), `getBrainSession` (~L524)
  in `/Users/Joe/frege/frege.dev/lib/core/brain.ts`. Routes under
  `/Users/Joe/frege/frege.dev/app/api/v1/sessions/`.

**LLM invocation:**
- `invokeModel(input)` in `/Users/Joe/frege/frege.dev/lib/core/model-gateway.ts` (L53),
  trust-zone enforced, providers via
  `/Users/Joe/frege/frege.dev/lib/core/provider-call.ts`.

**Auth / scoping:**
- Agent/API-key auth: `authenticateFregeActor(req)` in
  `/Users/Joe/frege/frege.dev/lib/core/actor-auth.ts` (L62), returns actor with
  `allowedLabels` and org; `assertCanUseTrustZone(actor, zone)` in brain.ts.
- Admin auth: `authenticateAdminRequest` in
  `/Users/Joe/frege/frege.dev/lib/core/admin-auth.ts` (requires `canManageOrg`).

**Telemetry / audit:**
- `logTelemetryEvent` in `/Users/Joe/frege/frege.dev/lib/core/telemetry.ts` (used by all
  brain routes); org audit `logPrototypeAuditEvent` in
  `/Users/Joe/frege/frege.dev/lib/core/audit.ts`; platform audit `recordPlatformAudit`
  in `/Users/Joe/frege/frege.dev/lib/core/platform-audit.ts` (best-effort, never throws).

**MCP server (thin proxy — logic stays server-side):**
- `/Users/Joe/frege/frege.dev/packages/frege-cli/bin/frege-mcp.mjs`: `tools[]` array
  (L20+) declares tool schemas; `callTool(name, input)` (L693) maps each tool to a REST
  call with `Authorization: Bearer` (key from `FREGE_API_KEY`). Adding a tool = one
  `tools[]` entry + one `callTool` branch. Authz is enforced by the REST routes, never
  in this file.

**Admin UI:**
- `/Users/Joe/frege/frege.dev/app/admin/AdminConsole.tsx` — tabbed console; the `brain`
  tab already lists `memoryProposals` (row type `MemoryProposalRow` ~L125). Styles in
  `/Users/Joe/frege/frege.dev/app/admin/admin.module.css`.

**Tests:**
- `pnpm test` runs `node --test scripts/prototype/test-*.mjs`. Copy the unit-test
  pattern from `/Users/Joe/frege/frege.dev/scripts/prototype/test-brain-proposals.mjs`:
  it uses `registerHooks` from `node:module` to map the `@/` alias and inject a fake
  `getSql()` (tagged-template SQL stub via `globalThis.__fakeSql`) so core functions are
  testable without a DB.

---

## §2 — PHASE 0: FOUNDATIONS (you do this yourself, on `feat/skills-compiler`)

Branch off `main`: `git checkout -b feat/skills-compiler` (run inside
`/Users/Joe/frege/frege.dev`).

### 2.1 Migration `/Users/Joe/frege/frege.dev/db/030_skills_compiler.sql`
Idempotent. Contents:
- `alter table brain_pages add column if not exists artifact_type text not null default 'page'`
  plus a CHECK (`artifact_type in ('page','skill')`) added defensively (drop/re-add
  constraint pattern consistent with existing migrations).
- Skill governance columns on `brain_pages` (all nullable, only meaningful when
  `artifact_type='skill'`): `valid_from timestamptz`, `invalidated_at timestamptz`,
  `superseded_by uuid`, `stale_flagged_at timestamptz`, `stale_reason text`.
  Per-claim citations, `confidence`, and `source_refs` live in the existing
  `frontmatter jsonb` (they are render/review data, not query predicates in v1).
- Extend `memory_proposals_type_chk` to add `'skill_create'` and `'skill_update'`
  (drop constraint if exists, re-create with the full list).
- New table `raw_materials`: `id uuid pk default gen_random_uuid()`, `org_id`,
  `source_type text check (source_type in ('session','markdown_upload'))`,
  `content_md text not null`, `provenance jsonb not null` (source description, author,
  date), `occurred_at timestamptz`, `created_by`, `created_at timestamptz default now()`,
  `compiled_at timestamptz`, `compile_result text` — mirror column style of db/006.
- Verify with `pnpm db:migrate` against the local/dev database.

### 2.2 Shared module `/Users/Joe/frege/frege.dev/lib/core/skills.ts` (skeleton only)
You write the types and signatures; WT-A fills in the bodies it owns. Include:
- `export type RawMaterial = { content: string; provenance: Record<string, unknown>; occurred_at: string | null; source_type: "session" | "markdown_upload" }`
- `export const SKILLS_COMPILER_ENABLED = () => process.env.FREGE_SKILLS_COMPILER === "true"`
- Telemetry/audit name constants:
  `SKILL_RETRIEVED = "skill.retrieved"`, `SKILL_CORRECTED = "skill.corrected"`,
  admin actions `admin.skills.accept|reject|export`, resourceType `"skill_proposal"`.
- `validateCitations(citations, sql)` signature — resolves each citation ref against
  `brain_session_events` / `brain_pages`; returns `{ ok: boolean; unresolved: string[] }`.
- `renderSkillMd(row)` signature — renders portable Agent Skills-format SKILL.md
  (standard-clean YAML frontmatter: name, description; governance metadata stays in DB;
  in-body citations as footnote anchors `[^n]` mapped to source refs).

### 2.3 API contract (subagents build against THIS, not against each other's unmerged code)
All routes 404 (not_found) when `FREGE_SKILLS_COMPILER` is not `"true"`.

- `POST /api/v1/materials` (admin-authed via `authenticateAdminRequest`):
  body `{ source_type: "markdown_upload", content_md, provenance: { source_description, author, date }, occurred_at? }`
  → `201 { material: { id, source_type, created_at } }`. Missing provenance fields → 400.
- `POST /api/v1/skills/compile` (admin-authed):
  body `{ material_id }` OR `{ session_id }` (batch = exactly one session or one
  uploaded file) →
  `200 { result: "proposal_filed", proposal_id }` |
  `200 { result: "nothing_found", reason }` |
  `200 { result: "failed", reason }` (unresolvable citations are `failed`; also
  server-logged; never filed).
- `GET /api/v1/skills` (agent-authed via `authenticateFregeActor`, scoped): list of
  approved skills visible to the key → `{ skills: [{ slug, title, valid_from, stale: boolean }] }`.
  Does NOT fire telemetry.
- `GET /api/v1/skills/[slug]` (agent-authed, scoped): `{ skill: { slug, title, body_md,
  citations, valid_from, stale, stale_reason } }`; fires `skill.retrieved`. Out-of-scope
  or restricted → `404 not_found` (indistinguishable from absent).
- `GET /api/v1/skills/[slug]?format=skillmd` (admin-authed): rendered portable SKILL.md
  as `text/markdown` (the export). Fires `admin.skills.export` audit, not `skill.retrieved`.

### 2.4 Commit Phase 0, then create worktrees (run from `/Users/Joe/frege/frege.dev`):
```bash
git add db/030_skills_compiler.sql lib/core/skills.ts && git commit -m "feat(skills): phase 0 — migration 030, shared skills module, API contract"
git worktree add /Users/Joe/frege/wt-compiler  -b feat/skills-wt-a feat/skills-compiler
git worktree add /Users/Joe/frege/wt-serving   -b feat/skills-wt-b feat/skills-compiler
git worktree add /Users/Joe/frege/wt-admin-ui  -b feat/skills-wt-c feat/skills-compiler
```

---

## §3 — SUBAGENT BRIEFS (spawn one subagent per worktree, in parallel)

Every brief below is given to its subagent verbatim, prefixed with:
> You are a subagent of the skills-compiler orchestration. Work ONLY inside your
> worktree directory and ONLY on your owned files. The design rationale is at
> `/Users/Joe/frege/frege.dev/plans/2026-07-22-governed-skills-compiler-design.md` and
> the API contract + repo facts are in
> `/Users/Joe/frege/frege.dev/plans/2026-07-22-skills-compiler-codex-orchestration.md`
> (§1–§2). Commit granularly. When done, report: what shipped, what's uncertain, what
> you skipped and why.

### WT-A — `wt-compiler` (worktree `/Users/Joe/frege/wt-compiler`, branch `feat/skills-wt-a`)
**Owns (absolute paths within the worktree mirror these repo paths):**
- `/Users/Joe/frege/wt-compiler/lib/core/skills.ts` (fill in bodies; do not change
  Phase-0 signatures)
- `/Users/Joe/frege/wt-compiler/app/api/v1/materials/route.ts` (new)
- `/Users/Joe/frege/wt-compiler/app/api/v1/skills/compile/route.ts` (new)
- `/Users/Joe/frege/wt-compiler/lib/core/brain.ts` (ONLY the `resolveMemoryProposal`
  accept/reject branches for `skill_create`/`skill_update` + `skill.corrected` emission)
- `/Users/Joe/frege/wt-compiler/scripts/prototype/test-skills-compiler.mjs` (new)

**Tasks:**
1. Materials upload route per §2.3 contract (admin-authed, provenance required,
   inserts `raw_materials`).
2. Session adapter: load one `brain_sessions` row + its `brain_session_events` into a
   `RawMaterial` (reuse `getBrainSession`-style access, respect trust zones).
3. Compile pass: one `invokeModel` call per batch asking "is there a repeatable
   procedure or durable fact here?"; on yes, draft SKILL.md (title, instructions,
   scope, `[^n]` citation anchors) with per-claim citations referencing session-event
   ids / material ids; run `validateCitations`; unresolvable ⇒ `failed` (server log,
   nothing filed); nothing repeatable ⇒ `nothing_found`; else file a
   `skill_create` proposal via `createMemoryProposal` with the draft in the proposal
   body and citations in metadata. Return the §2.3 result summary.
4. Extend `resolveMemoryProposal`: on accept of `skill_create`/`skill_update`, write
   `brain_pages` row with `artifact_type='skill'`, `valid_from=now()`, frontmatter
   carrying citations/confidence/source_refs. On reject: emit `skill.corrected`
   `{ action: "reject", proposal, reason }`. On accept-after-edit: emit
   `skill.corrected` `{ action: "edit", diff: { before, after } }`. Rollback of a skill
   revision emits `{ action: "rollback", from_revision, to_revision }`.
5. Staleness v1 (PRE-AUTHORIZED DEFERRAL if you exceed budget — say so in your report):
   during each compile pass, fetch ALL approved skills in the batch's scope (<10 rows at
   v1 volume; do NOT join on source_refs — fresh uploads never overlap), ask the model a
   yes/no contradiction question per skill; on yes set `stale_flagged_at`/`stale_reason`.
   Never edit skill content autonomously.
6. Unit tests in your owned test file using the `registerHooks` fake-SQL pattern from
   `/Users/Joe/frege/frege.dev/scripts/prototype/test-brain-proposals.mjs`: citation
   validation (resolvable/unresolvable), compile result mapping (filed/nothing/failed),
   resolve branches (accept creates skill page; reject emits corrected event), stale
   flag set on contradiction=yes.

**Done when:** `node --test scripts/prototype/test-skills-compiler.mjs` green inside the
worktree; `pnpm test` green; flag off ⇒ routes 404.

### WT-B — `wt-serving` (worktree `/Users/Joe/frege/wt-serving`, branch `feat/skills-wt-b`)
**Owns:**
- `/Users/Joe/frege/wt-serving/app/api/v1/skills/route.ts` (new)
- `/Users/Joe/frege/wt-serving/app/api/v1/skills/[slug]/route.ts` (new)
- `/Users/Joe/frege/wt-serving/packages/frege-cli/bin/frege-mcp.mjs` (additive only:
  two `tools[]` entries + two `callTool` branches)
- `/Users/Joe/frege/wt-serving/scripts/prototype/test-skills-serving.mjs` (new)

**Tasks:**
1. `GET /api/v1/skills` and `GET /api/v1/skills/[slug]` per §2.3: agent-authed
   (`authenticateFregeActor`), scope-filtered exactly like existing page reads
   (sensitivity/trust-zone rules) — restricted/out-of-scope slug returns the same 404
   shape as a nonexistent slug. `?format=skillmd` branch is admin-authed and returns
   `renderSkillMd` output as `text/markdown`.
2. Implement `renderSkillMd` body in a serving-local helper if WT-A hasn't merged yet —
   final home is `lib/core/skills.ts`; coordinate at merge (orchestrator resolves).
3. Telemetry: `skill.retrieved` (via `logTelemetryEvent`, resourceType
   `"skill_proposal"` for proposals, `"skill"` for approved reads) fires ONLY on the
   `[slug]` GET (not list, not export); `admin.skills.export` audit on the skillmd branch.
4. MCP: add `frege_list_skills` (→ `GET /api/v1/skills`) and `frege_get_skill`
   (→ `GET /api/v1/skills/:slug`) to
   `/Users/Joe/frege/wt-serving/packages/frege-cli/bin/frege-mcp.mjs`, matching the
   existing tool-schema style.
5. Unit tests: scoping (unscoped key → not_found), retrieval telemetry fired on get
   only, skillmd render includes footnote citations.

**Done when:** tests green; MCP tools callable against a locally running dev server;
flag off ⇒ 404 and tools return the standard error shape.

### WT-C — `wt-admin-ui` (worktree `/Users/Joe/frege/wt-admin-ui`, branch `feat/skills-wt-c`)
**Owns:**
- `/Users/Joe/frege/wt-admin-ui/app/admin/AdminConsole.tsx`
- `/Users/Joe/frege/wt-admin-ui/app/admin/admin.module.css`

**Tasks (build against the §2.3 contract, not against A/B code):**
1. In the `brain` tab (or a flag-gated `skills` sub-section): markdown upload form
   (content + required provenance fields) posting to `POST /api/v1/materials`; a
   Compile button per material/session posting to `POST /api/v1/skills/compile` and
   rendering the result summary verbatim (`proposal_filed` with link /
   `nothing_found` / `failed` with reason).
2. Skill-proposal rendering in the existing review queue: show SKILL.md body,
   citations list, confidence (display only), and accept/reject via the existing
   `PATCH /api/v1/admin/brain/proposals/[id]` flow.
3. Approved-skill row affordances: stale badge (`stale_flagged_at` set → "stale —
   review suggested" with `stale_reason`), and an Export button hitting
   `GET /api/v1/skills/[slug]?format=skillmd` (download/copy).
4. Entire section renders nothing when the flag is off (drive off a
   `/api/v1/skills` 404 or a passed-down flag — match how AdminConsole gates other
   sections).

**Done when:** `pnpm dev` locally shows the full flow UI-side with mocked/real API;
no other files modified; visual style consistent with existing admin.module.css.

---

## §4 — MERGE + QA SEQUENCE (orchestrator, after all subagents report)

1. Merge order into `feat/skills-compiler`: **A → B → C.** Expected seams: `lib/core/skills.ts`
   (A owns bodies; B may carry a temporary render helper — move it into skills.ts and
   delete the duplicate) and imports in `brain.ts`. Reject any diff outside a
   subagent's ownership list.
2. `pnpm db:migrate` (local/dev DB), then `pnpm test` — the full suite, not just new
   files. Existing brain/proposal/auth/billing tests must stay green (zero-regressions
   criterion).
3. Manual smoke (local `pnpm dev`, `FREGE_SKILLS_COMPILER=true`):
   upload md → compile → `proposal_filed` → proposal visible in admin brain tab →
   accept → `GET /api/v1/skills/[slug]` returns it and logs `skill.retrieved` →
   `frege_get_skill` via MCP works → edit-and-accept a second compiled proposal →
   `skill.corrected` logged with diff → unscoped key gets 404 on a restricted skill →
   flag off ⇒ everything invisible, existing app unchanged.
4. Remove the three worktrees, push `feat/skills-compiler`, open ONE PR to `main`:
   title `feat: governed skills compiler (Company Brain loop v1)`, body links
   `/Users/Joe/frege/frege.dev/plans/2026-07-22-governed-skills-compiler-design.md`
   and lists any deferred items (e.g., staleness if the fallback fired).
5. STOP. Report to Joe: what shipped, test results, deferred items, and the one action
   waiting on him — **be reviewer #1: review, correct, and accept the first compiled
   skill so `skill.corrected` records row #1 of the failure corpus.** Do not deploy.

## §5 — SUCCESS CRITERIA & BUDGET (from the design doc)

- A captured session or uploaded markdown file compiles into a SKILL.md proposal with
  per-claim citations.
- The proposal appears in the existing review queue; Joe can edit, approve, reject,
  merge, roll back.
- An approved skill is retrievable via MCP under existing scoping; a restricted skill
  returns not_found to an unscoped key.
- `skill.retrieved` and `skill.corrected` events land in the ledger; at least one real
  correction recorded.
- One staleness flag demonstrably fires on contradicting material (stretch if the
  pre-authorized fallback is taken).
- Zero regressions on existing auth/billing/memory paths.

Budget honesty: ~15.5 focused hours of implementation + 2–3 hours QA. The
pre-authorized fallback (ship everything except staleness) is the expected path if the
budget tightens — take it rather than compressing QA.
