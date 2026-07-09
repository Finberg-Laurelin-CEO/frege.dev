# Claude Frontend Handoff

This note is for a frontend/design agent working on Frege aesthetics after the backend/MCP baseline is committed.

## Goal

Make the Frege site and admin shell more beautiful, clearer, and more polished without changing backend behavior, API contracts, database schema, auth, telemetry, or deployment settings.

## Branching

Start from the backend baseline after it is committed and pushed. Use a separate branch:

```text
design/site-aesthetic-pass
```

Do not work directly on the backend/control-plane branch unless explicitly asked.

## Allowed Work

Frontend-only changes are allowed in:

```text
app/**/*.tsx
app/**/*.css
app/**/*.module.css
public/**
```

Use existing data and APIs. Keep `/setup`, `/login`, `/admin`, and `/prototype` functional.

Good targets:

- Visual hierarchy, spacing, typography, color, and responsive layout.
- Admin console information design.
- Empty/loading/error states.
- Navigation clarity.
- Button, form, table, tab, and panel styling.
- Accessible contrast and focus states.
- Non-sensitive demo copy.

## Hard Boundaries

Do not change these unless the user explicitly opens a backend branch for it:

```text
app/api/**
db/**
lib/core/**
scripts/**
packages/frege-cli/**
package.json
pnpm-lock.yaml
next.config.ts
vercel.json
.env*
```

Do not:

- Change auth/session/API-key behavior.
- Change tenancy or org guard logic.
- Change telemetry/audit behavior.
- Change model routing or context gateway behavior.
- Add new dependencies without approval.
- Move routes or rename public API fields.
- Read or import anything from the Obsidian vault.
- Put secrets, raw API keys, bootstrap tokens, or provider keys into source files.

## Verification Before Handoff

Run:

```bash
pnpm run typecheck
pnpm run build
curl http://localhost:3000/api/v1/health
frege doctor
frege search refund --limit 2
frege context "restricted red zone" --limit 5
```

Expected behavior:

- Health returns ok.
- Frege CLI remains connected.
- Search returns dummy green docs.
- Restricted context returns a denied count without restricted body text.

## Design Notes

Frege is a backend/control-plane and agent-memory product, not a marketing splash page. The UI should feel operational, trustworthy, and high-signal:

- Dense but readable admin surfaces.
- Clear table and form states.
- Strong source/audit/telemetry affordances.
- Calm visual style, not decorative clutter.
- Prefer clarity over dramatic landing-page effects.
