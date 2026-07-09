# Customer OAuth Setup (Google + GitHub) — Step by Step

This guide turns on "Continue with Google" / "Continue with GitHub" for customer
sign-in. **Clerk mode (below) is the current path**; the hand-rolled provider
integration further down stays in the tree as a dormant fallback.

---

## Clerk mode (current)

Founder decision: Clerk is the OAuth **broker only** — it runs the Google/GitHub
handshake, we verify the resulting Clerk session JWT server-side
(`POST /api/v1/auth/clerk/bridge`), link-or-create the user through the same
`user_identities` store as the hand-rolled flow, mint our own `frege_session`
cookie, and sign the browser out of Clerk again. Password login is unchanged and
Frege's session model stays the single source of truth. Identity rows are
written as `(provider: 'google'|'github', provider_subject)` — identical to the
hand-rolled flow, so no migration beyond `db/025_user_identities.sql` is needed
and both flows can coexist.

Two environment variables switch it on (both must be set; otherwise the login
page hides the buttons and the bridge returns `oauth_not_configured`):

| Variable | What it is |
|---|---|
| `CLERK_SECRET_KEY` | Server-side key; verifies session JWTs and reads the Clerk user |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public key; boots CDN-loaded clerk-js on the login page |

Setup:

1. `vercel integration add clerk` (Vercel marketplace) — provisions both keys on
   the project automatically. Pull them locally with `vercel env pull`.
2. In the [Clerk dashboard](https://dashboard.clerk.com): **User & authentication
   → Social connections** — enable **Google** and **GitHub**. On a Clerk
   **development instance** that is all: Clerk ships instant shared OAuth
   credentials, no Google/GitHub console work needed.
3. **Production instance**: Clerk requires your own OAuth credentials for
   custom domains. Create the Google client / GitHub app exactly as described in
   sections 2–3 below, but register the **Clerk callback URLs shown in the
   dashboard** (e.g. `https://clerk.frege.dev/v1/oauth_callback`) instead of the
   `/api/v1/auth/oauth/...` ones, and paste the credentials into the social
   connection settings.
4. Redeploy. The login page shows both buttons whenever the publishable key is
   present; the Clerk handshake finishes on `/login?clerk=cb`, which POSTs the
   Clerk token to the bridge and then redirects into the console with the normal
   `frege_session` cookie set.

Notes:

- We deliberately use `@clerk/backend` only (no `@clerk/nextjs`, no
  ClerkProvider, no middleware changes). The browser loads `@clerk/clerk-js@5`
  from the CDN lazily on the login page.
- Hermetic tests: `node --test scripts/prototype/test-clerk-auth.mjs`.
- Users who signed up through Clerk with email codes (no Google/GitHub account)
  are linked/created by verified email without an identity row.

---

## Hand-rolled mode (dormant fallback)

Everything below covers the direct provider integration. It remains deployed
but **inert** until you add the four env vars below — the login/signup pages
hide the buttons and the start routes return `oauth_not_configured` while any
provider's pair is missing. When Clerk mode is enabled it takes precedence in
the UI; the hand-rolled routes stay functional for a fallback or rollback.

Customer OAuth is hand-rolled against the provider endpoints directly (explicit
founder decision: **no Auth0 for customers** — Auth0 stays staff-only for the
admin console). Nothing here goes in the repo or in chat — every secret lives in
Vercel environment variables.

---

## 0. What you'll end up with

Four environment variables in Vercel:

| Variable | What it is | Example |
|---|---|---|
| `FREGE_OAUTH_GOOGLE_CLIENT_ID` | Google OAuth client ID | `1234567890-abc123.apps.googleusercontent.com` |
| `FREGE_OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret | `GOCSPX-...` |
| `FREGE_OAUTH_GITHUB_CLIENT_ID` | GitHub OAuth app client ID | `Iv1.abc123...` or `Ov23li...` |
| `FREGE_OAUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | 40-char hex string |

The variable **names must match exactly** — the app reads these names directly.
A provider is "on" only when **both** its ID and secret are set.

Run migration `db/025_user_identities.sql` (via `pnpm db:migrate`) before
enabling either provider — the callback writes to `user_identities`.

---

## 1. Callback URLs (register these exactly)

The callback always lives on the **app host**. In production that is
`brain.frege.dev` regardless of whether the user started on `frege.dev` — the
start route builds the redirect URI from `FREGE_APP_BASE_URL` /
`FREGE_PUBLIC_BASE_URL` (see `lib/core/public-url.ts`), and the short-lived
state cookie is shared across `.frege.dev` so the handshake survives the host
hop. On localhost and Vercel previews the callback stays on the requesting
host.

| Environment | Google + GitHub callback URL |
|---|---|
| Production | `https://brain.frege.dev/api/v1/auth/oauth/google/callback` and `.../github/callback` |
| Vercel preview | `https://<your-preview-alias>.vercel.app/api/v1/auth/oauth/google/callback` and `.../github/callback` |
| Local dev | `http://localhost:3000/api/v1/auth/oauth/google/callback` and `.../github/callback` |

Notes:

- Do **not** register a `https://frege.dev/...` callback — the marketing host
  never receives the callback in production.
- Previews get a fresh URL per deploy. Register a **stable preview alias**
  (e.g. `frege-git-main-yourteam.vercel.app` or a custom preview domain)
  rather than per-deploy URLs. GitHub OAuth apps allow only **one** callback
  URL per app, so create a **separate GitHub OAuth app per environment**
  (production / preview / local). Google allows multiple redirect URIs on one
  client, so a single Google client can list all three.

---

## 2. Create the Google OAuth client

1. Go to https://console.cloud.google.com/apis/credentials (pick or create a
   project for Frege).
2. Configure the consent screen first if prompted (**APIs & Services → OAuth
   consent screen**): User type **External**, app name **Frege**, add your
   support email. Scopes: only the non-sensitive defaults
   (`openid`, `email`, `profile`) — the app requests exactly
   `openid email profile`. Publish the app (leaving it in Testing mode limits
   sign-in to allowlisted test users).
3. **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `frege-customer-oauth`
   - Authorized redirect URIs: add the Google callback URLs from section 1
     (production, preview alias, and localhost as needed).
4. Copy the **Client ID** and **Client secret**.

No API enablement is needed — the app uses the token endpoint plus the
`id_token` claims (with the OIDC userinfo endpoint as fallback), and PKCE
(S256) on top of the client secret.

## 3. Create the GitHub OAuth app

1. Go to https://github.com/settings/developers (or your org's
   **Settings → Developer settings**) → **OAuth Apps → New OAuth App**.
2. Fill in:
   - Application name: `Frege` (suffix per environment, e.g. `Frege (preview)`)
   - Homepage URL: `https://frege.dev`
   - Authorization callback URL: the GitHub callback URL from section 1 for
     **this** environment (one per app — see the note above).
3. Register, then **Generate a new client secret**. Copy the **Client ID** and
   the secret immediately (the secret is shown once).

The app requests `read:user user:email` scopes and only signs a user in when
their **primary GitHub email is verified**.

---

## 4. Add the env vars to Vercel

For each environment you're enabling (repeat with the preview-app credentials
for `preview`, and use `development` for local `vercel env pull`):

```sh
vercel env add FREGE_OAUTH_GOOGLE_CLIENT_ID production
vercel env add FREGE_OAUTH_GOOGLE_CLIENT_SECRET production
vercel env add FREGE_OAUTH_GITHUB_CLIENT_ID production
vercel env add FREGE_OAUTH_GITHUB_CLIENT_SECRET production
```

Each command prompts for the value — paste the credential from sections 2–3.
Then redeploy so the new env vars take effect. If this repo deploys as two
Vercel projects (marketing + brain), add the vars to **both** — the login page
renders on the marketing host and the callback runs on the app host.

You can enable one provider without the other; the UI only shows buttons for
configured providers.

---

## 5. Verify

1. Open `https://frege.dev/login` — the "Continue with Google/GitHub" buttons
   appear under the password form.
2. Sign in with a Google account whose email matches an existing user: you
   land in `/console` with the normal `frege_session` cookie, and a
   `user_identities` row now links the account.
3. Sign in with a brand-new email: a minimal user is created (verified email,
   no password, no org) and the console shows its no-org state.
4. Failures never 500 — they bounce back to `/login?error=oauth_...` with a
   human-readable message.

Do **not** create real credentials while testing flows in code review; use the
hermetic tests (`node --test scripts/prototype/test-oauth.mjs`) instead.
