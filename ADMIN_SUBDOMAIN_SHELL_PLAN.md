# Admin Subdomain Shell Plan

Branch: `feature/admin-subdomain-shell`

## Goal
Make the admin deploy feel and behave like a separate operations app at `admin.frege.dev`:

- no public marketing nav on admin pages
- Auth0 remains the admin human sign-in
- `/platform` is the primary admin panel entry point
- support both the current `FREGE_ADMIN_ONLY=true` admin Vercel project and future `admin.frege.dev` hostname detection

## Current state

- `app/layout.tsx` always renders `SiteNav`, so the public nav appears on admin surfaces.
- `middleware.ts` already supports `FREGE_ADMIN_ONLY=true` and redirects non-admin paths to `/platform`.
- `requirePlatformStaffPage()` already uses Auth0 in admin mode and falls back to app sessions on the main site.
- Auth0 base URL comes from env/config, so `admin.frege.dev` is mostly a Vercel/Auth0 configuration task once the shell is cleaned up.

## Implementation steps

1. **Create admin shell navigation**
   - Add a small admin-only nav component, e.g. `app/components/AdminNav.tsx` or `app/platform/AdminNav.tsx`.
   - Links: `Frege Admin` → `/platform`, `platform`, `org admin` if still needed, `logout` → `/auth/logout` in Auth0 mode.
   - Do not include public links: how, memory, security, pricing, docs, GitHub, request access.

2. **Hide public nav on admin-only deploy**
   - Update `app/layout.tsx` so `SiteNav` is not rendered when `process.env.FREGE_ADMIN_ONLY === "true"`.
   - Render the new admin nav for admin-only deploys, or render it inside `/platform` and other admin pages.
   - Keep public site behavior unchanged when `FREGE_ADMIN_ONLY` is unset.

3. **Make middleware hostname-aware**
   - Update `middleware.ts` so admin mode is true when either:
     - `FREGE_ADMIN_ONLY === "true"`, or
     - request host starts with `admin.`
   - Keep the existing allowed admin path list.
   - Keep `/auth/*` delegated to Auth0 middleware.

4. **Metadata / robots**
   - Ensure admin pages remain `noindex`.
   - Avoid marketing metadata on admin-only deploy where possible.

5. **Admin domain setup docs**
   - Add a short doc section describing manual setup:
     - Vercel custom domain: `admin.frege.dev` on the admin project
     - `APP_BASE_URL=https://admin.frege.dev`
     - `FREGE_ADMIN_ONLY=true`
     - Auth0 Allowed Callback URL: `https://admin.frege.dev/auth/callback`
     - Auth0 Allowed Logout URL and Web Origin: `https://admin.frege.dev`

## Verification

Run:

```bash
pnpm typecheck
pnpm build
```

Manual checks:

- Main site with `FREGE_ADMIN_ONLY` unset still shows public nav.
- Admin deploy with `FREGE_ADMIN_ONLY=true` does not show public marketing nav.
- `/` redirects to `/platform` on admin deploy.
- `/auth/login` and `/auth/callback` still work.
- `/platform` requires Auth0 and lands on the platform console.

## Out of scope

- Do not migrate user-side auth to Auth0 here.
- Do not change Stripe/billing behavior here.
- Do not redesign the platform console tables here beyond shell/navigation cleanup.
