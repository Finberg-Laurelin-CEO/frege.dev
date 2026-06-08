# Hermes Setup - Frege Signup Monitoring

Last updated: 2026-06-08.

## Production Endpoints

- Stats endpoint: `https://frege.dev/api/admin/frege-signup-stats`
- Cron route: `https://frege.dev/api/cron/frege-signup-stats`
- Vercel Cron schedule: `0 */8 * * *`

## Vercel Environment Variables

These must be server-side only:

- `HERMES_FREGE_SIGNUP_WEBHOOK_URL`
- `HERMES_FREGE_WEBHOOK_SECRET`
- `FREGE_ADMIN_STATS_SECRET`
- `CRON_SECRET`

Do not prefix these with `NEXT_PUBLIC_`, and do not paste real values into
chat or docs.

## Webhook Auth

Frege sends Hermes webhook POSTs with:

```text
Content-Type: application/json
Authorization: Bearer ${HERMES_FREGE_WEBHOOK_SECRET}
X-Hub-Signature-256: sha256=<hmac of raw JSON body using HERMES_FREGE_WEBHOOK_SECRET>
```

The bearer header satisfies Frege's shared-secret contract. The HMAC header
also lets Hermes' stock webhook adapter validate the same shared secret.

## Stats Endpoint Auth

```bash
curl -sS https://frege.dev/api/admin/frege-signup-stats \
  -H "Authorization: Bearer $FREGE_ADMIN_STATS_SECRET"
```

Missing or wrong auth returns HTTP 401:

```json
{ "error": "unauthorized" }
```

## Current Hermes Ingress Requirement

The app is ready to call Hermes, but `HERMES_FREGE_SIGNUP_WEBHOOK_URL` must be a
stable public HTTPS URL that reaches Hermes' `frege-signups` webhook route.

On Joe's VPS, Hermes has been prepared locally at:

```text
http://127.0.0.1:8644/webhooks/frege-signups
```

Because the VPS has no external IP, a safe public ingress or outbound tunnel is
required before Vercel can deliver the webhook or cron stats snapshot.

Webhook failures do not block signup success.
