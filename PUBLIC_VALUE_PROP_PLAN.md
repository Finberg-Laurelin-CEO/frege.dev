# Public Value Proposition Plan

Branch: `feature/public-value-prop`

## Goal
Optimize the public site so visitors immediately understand:

- who Frege is for
- what pain it solves
- why it is better than ad-hoc `CLAUDE.md` / built-in agent memory once a team has multiple agents and access boundaries
- what to do next

## Working ICP
Platform and AI teams at 20–200 person companies running multiple agents against shared company knowledge who need access control, auditability, and reusable context.

## Current state

Relevant files:

- Home: `app/page.tsx`
- Global metadata/layout: `app/layout.tsx`
- Nav: `app/components/SiteNav.tsx`
- Pricing: `app/pricing/page.tsx`
- Signup: `app/signup/page.tsx`, `app/signup/signup.css`
- Thanks: `app/thanks/page.tsx`
- Global styles: `public/styles.css`
- Prior positioning notes: `plans/positioning-feedback-2026-06-22.md`

Current positioning says "company brain for AI agents" but is feature-heavy, does not name an ICP clearly enough, has too many CTAs, and does not show the product working.

## Implementation steps

1. **Rewrite homepage hero**
   - Name the user and pain in the first screen.
   - Suggested direction: "Your agents share a company. They should share a brain."
   - Two CTAs only: primary `Request pilot access`, secondary `See it work`.

2. **Add proof/demo section**
   - Add a terminal transcript section showing:
     - an agent asks for company context
     - Frege checks org/role/trust zone
     - permitted context comes back with citations
     - restricted context is denied
     - a useful memory proposal is submitted for review
   - Keep it static/CSS-only; no new dependency.

3. **Add honest comparison section**
   - Title: `Why not just CLAUDE.md?`
   - Explain that CLAUDE.md is great for one person / one repo.
   - Explain Frege is for teams needing shared memory, permissions, audit, reviewable writes, and consistent behavior across agents.

4. **Simplify navigation**
   - Keep: Docs, Architecture, Pricing, GitHub, Sign in, Request access.
   - Remove homepage anchor clutter from nav if it weakens CTA clarity.

5. **Rewrite pricing around value**
   - Add a "What you're replacing" intro.
   - Rewrite bullets as outcomes, not internal features.
   - Keep existing prices unless separately directed.

6. **Improve signup page conversion**
   - Add a short block: "What you get in the pilot".
   - Mention hosted brain provisioned, MCP keys, trust-zone setup, onboarding help, expected response window.

7. **Improve thanks page**
   - Add next steps: review, onboarding call, first MCP key.

8. **Update metadata and OG image**
   - Use ICP + outcome framing in title/description/OG text.

## Verification

Run:

```bash
pnpm typecheck
pnpm build
```

Manual checks:

- Home page has one obvious primary CTA.
- Page still works at mobile width.
- Signup form still submits to `/api/signup` unchanged.
- No fake logos/testimonials are added.
- Pricing values remain consistent with billing code unless intentionally changed.

## Out of scope

- Do not touch admin/platform UI here.
- Do not change auth, Stripe, or database behavior here.
- Do not invent customer proof.
