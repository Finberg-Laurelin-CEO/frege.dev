# User Auth and API Keys Plan

Branch: `feature/user-auth-api-keys`

## Goal
Make the user-side sign-in, invite acceptance, billing entry, and API key lifecycle reliable and easy to verify.

This is separate from the Auth0 admin sign-in. Admin Auth0 is for staff. User auth currently uses app sessions and password credentials.

## Current state

Relevant files:

- Login page: `app/login/page.tsx`, `app/login/LoginPanel.tsx`
- Login API: `app/api/v1/auth/login/route.ts`
- Logout API: `app/api/v1/auth/logout/route.ts`
- Invite accept API: `app/api/v1/auth/invites/accept/route.ts`
- Page auth: `lib/prototype/page-auth.ts`
- Sessions: `lib/prototype/session.ts`
- Org admin UI: `app/admin/AdminConsole.tsx`
- API key API: `app/api/v1/admin/api-keys/route.ts`
- API key validation: `lib/prototype/keys.ts`, `lib/prototype/auth.ts`
- Runtime routes using keys: `app/api/v1/context/build`, `app/api/v1/model/invoke`, document/search/map routes

Current user API keys use `frg_live_...`, are stored hashed, belong to an org/role/owner, and should authenticate runtime/API requests.

## Implementation steps

1. **Audit user sign-in flow**
   - Verify `/login?next=/admin` and `/login?next=/billing` redirect safely after successful login.
   - Verify invalid credentials and disabled users show readable UI status.
   - Verify session cookie settings are correct in production.

2. **Polish invite acceptance**
   - Inspect `app/invite` UI and `app/api/v1/auth/invites/accept/route.ts`.
   - Ensure accepted invites create or activate the user, set password credentials when missing, create active membership, mark invite accepted, and create a session.
   - Ensure accepted users land on the next useful page, usually `/billing` for inactive orgs or `/admin` for active orgs.

3. **Make API key management user-verifiable**
   - In org admin UI, ensure API key creation clearly shows the raw key once and explains it cannot be shown again.
   - Ensure owner selection, role selection, expiration, status, and revoke behavior are clear.
   - Add copy-ready examples for using the key in a Bearer header.

4. **Add/extend smoke coverage**
   - Add a script or extend `scripts/prototype/smoke-admin.mjs` / `smoke-backend.mjs` to verify:
     - login works with a seeded/test user when credentials are provided through env
     - API key creation endpoint works for an org admin
     - generated key can call a runtime endpoint that requires `frg_live_...`
     - revoked key no longer works
   - Do not commit secrets. Use env vars only.

5. **Clarify user auth boundaries**
   - Keep Auth0 admin sign-in separate.
   - Do not accidentally require Auth0 for customer/user pages.
   - Customer pages should continue using app session cookies unless a future migration explicitly changes that.

## Verification

Run:

```bash
pnpm typecheck
pnpm build
```

Then verify manually or with smoke scripts:

- Invite link → set password → session created.
- Login → `/admin` works for org owner/admin.
- Login → `/billing` works for org owner/admin.
- API key creation returns one raw `frg_live_...` key.
- A valid key can call an org-scoped runtime/API endpoint.
- A revoked key fails.
- Disabled user/session fails cleanly.

## Out of scope

- Do not replace user auth with Auth0 in this branch.
- Do not change staff/admin Auth0 flow.
- Do not change Stripe revenue reporting except where needed to route inactive users to billing.
