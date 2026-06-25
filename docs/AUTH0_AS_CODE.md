# Auth0 admin URLs as code

The admin sign-in (`admin.frege.dev`) relies on three URLs being set on the
Auth0 application: allowed callback, logout, and web-origin. These were set by
hand in the dashboard once. This makes them reproducible so the fix can't get
lost on a future tenant or application change.

## Source of truth

`scripts/prototype/auth0-app-config.json` — the desired production URLs. No
secrets live here. The sync script **union-merges** these into whatever is
already set, so localhost/preview URLs added for development are preserved.

## One-time grant (required before the script can run)

The admin application must be allowed to call the Auth0 Management API:

1. Auth0 dashboard → **Applications → APIs → Auth0 Management API**.
2. **Machine to Machine Applications** tab → enable the admin app
   (client id ends in `…A7sYbd`).
3. Add scopes: **`read:clients`** and **`update:clients`** → Update.

Without this grant the script exits with a clear message telling you to do the
above. It never makes partial changes.

## Apply

Credentials come from the environment only (the same `AUTH0_*` vars the
`frege-admin` Vercel project already has). Pull them, then run:

```bash
# from the frege-admin project context, or export AUTH0_DOMAIN / AUTH0_CLIENT_ID
# / AUTH0_CLIENT_SECRET manually
pnpm auth0:sync:dry   # preview the merged URLs, applies nothing
pnpm auth0:sync       # apply
```

Re-running is safe and idempotent: if the application already matches the
config, it prints `Already in sync` and makes no API call to change anything.

## What it does not do

- It does not create or delete Auth0 applications.
- It does not touch secrets, connections, or tenant settings.
- It does not remove existing URLs — only adds the production ones if missing.
