# Stripe Setup (Vercel) — Step by Step

This guide turns on payments for Frege. The billing code is already deployed but
**inert** until you add the Stripe keys and price IDs below. Nothing here goes in
the repo or in chat — every secret lives in Vercel environment variables.

Do the whole thing in **Test mode** first. Switch to Live mode only when you've
verified a test payment activates an org.

---

## 0. What you'll end up with

Six environment variables in Vercel:

| Variable | What it is | Example |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret API key | `sk_test_...` (test) / `sk_live_...` (live) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook endpoint | `whsec_...` |
| `STRIPE_PRICE_SOLO_MONTHLY` | Price ID for Solo $20/mo | `price_...` |
| `STRIPE_PRICE_TEAM_MONTHLY` | Price ID for Team $20/user/mo | `price_...` |
| `STRIPE_PRICE_TEAM_ANNUAL` | Price ID for Team $15/user/mo billed annually | `price_...` |
| `FREGE_PUBLIC_BASE_URL` *(optional)* | Public site URL for redirects | `https://frege.dev` |

The variable **names must match exactly** — the app reads these names directly.

---

## 1. Log in to the Laurelin Stripe account

1. Go to https://dashboard.stripe.com and sign in to the Laurelin account.
2. Top-right, make sure the **Test mode** toggle is **ON** (you'll see "Test mode").

---

## 2. Create the three Products + Prices

You need three recurring prices. Create them under **Product catalog → Add product**.

### Solo — $20 / month
1. Product catalog → **Add product**.
2. Name: `Frege Solo`.
3. Pricing: **Recurring**, **Monthly**, amount **$20.00 USD**.
4. Save. Open the product, find the **Price ID** under the price (starts with `price_`).
5. Copy it → this is `STRIPE_PRICE_SOLO_MONTHLY`.

### Team — $20 / user / month (monthly)
1. Add product. Name: `Frege Team (Monthly)`.
2. Pricing: **Recurring**, **Monthly**, amount **$20.00 USD**.
3. Under "More pricing options", set **Usage is** → **Per unit** (so quantity = seats).
4. Save. Copy the **Price ID** → `STRIPE_PRICE_TEAM_MONTHLY`.

### Team — $15 / user / month, billed annually
1. Add product. Name: `Frege Team (Annual)`.
2. Pricing: **Recurring**, **Yearly**.
3. Amount: **$180.00 USD** (that's $15 × 12, charged once per year per seat).
4. Set **Per unit** so quantity = seats, same as above.
5. Save. Copy the **Price ID** → `STRIPE_PRICE_TEAM_ANNUAL`.

> Note on the annual price: Stripe bills the **whole year up front**. $15/mo billed
> annually = **$180 per seat per year**. The site already explains this on /pricing.

---

## 3. Get your secret API key

1. Left sidebar → **Developers → API keys** (or top search "API keys").
2. Under **Standard keys**, reveal the **Secret key** (`sk_test_...`).
3. Copy it → this is `STRIPE_SECRET_KEY`.

Do **not** paste this anywhere except Vercel (next step).

---

## 4. Add the variables to Vercel

You can use the dashboard (easiest) or the CLI.

### Option A — Vercel dashboard
1. Go to https://vercel.com → the **frege.dev** project.
2. **Settings → Environment Variables**.
3. For each variable below, click **Add**, set the **Key** (exact name), paste the
   **Value**, choose environment **Production** (also add to **Preview** if you want
   to test on preview deploys), then **Save**:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PRICE_SOLO_MONTHLY`
   - `STRIPE_PRICE_TEAM_MONTHLY`
   - `STRIPE_PRICE_TEAM_ANNUAL`
   - `FREGE_PUBLIC_BASE_URL` = `https://frege.dev` (optional but recommended)
4. (You'll add `STRIPE_WEBHOOK_SECRET` in step 6.)

### Option B — Vercel CLI
Run each, paste the value when prompted, choose **Production**:
```bash
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_PRICE_SOLO_MONTHLY production
vercel env add STRIPE_PRICE_TEAM_MONTHLY production
vercel env add STRIPE_PRICE_TEAM_ANNUAL production
vercel env add FREGE_PUBLIC_BASE_URL production
```

> After changing env vars you must **redeploy** for them to take effect:
> `vercel --prod` or push a commit / click "Redeploy" in Vercel.

---

## 5. Register the webhook endpoint

The webhook is what flips an org to **active** after payment.

1. Stripe dashboard → **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL**: `https://frege.dev/api/v1/billing/webhook`
3. **Events to send** — click "Select events" and add:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. **Add endpoint**.

---

## 6. Add the webhook signing secret

1. Open the webhook you just created.
2. Click **Reveal** under **Signing secret** (`whsec_...`).
3. Copy it.
4. Add to Vercel as `STRIPE_WEBHOOK_SECRET` (same as step 4), **Production**.
5. **Redeploy** so the variable is live.

---

## 7. Test the full flow (Test mode)

1. Make sure an org exists that is **inactive** (a freshly approved pilot org, or
   ask the engineer to create a test org). Its agents should be blocked.
2. Sign in as that org's **owner**, go to `https://frege.dev/billing`.
3. Pick a plan and click **Continue to payment**.
4. On Stripe Checkout, use a **test card**: `4242 4242 4242 4242`, any future
   expiry, any CVC, any ZIP.
5. Complete payment. You should be redirected back to `/billing?status=success`.
6. Within a few seconds the org flips to **active** (check the `/platform` console →
   Orgs tab → status should read `active`). The org's agents now work.

If status doesn't flip:
- Stripe dashboard → Webhooks → your endpoint → check **recent deliveries** for a
  green 200. A 4xx/5xx there points at a missing/incorrect `STRIPE_WEBHOOK_SECRET`
  or a redeploy that didn't pick up the new env vars.

---

## 8. Go Live

When test works end to end:
1. Flip Stripe to **Live mode** (top-right toggle).
2. Recreate the three Prices in Live mode (you'll get new `price_...` IDs).
3. Get the **live** secret key (`sk_live_...`).
4. Create a **live** webhook endpoint (same URL, same events) and get its
   **live** `whsec_...`.
5. Update the five Vercel variables with the live values. **Redeploy.**
6. Do one real (small) payment to confirm, then refund it from the Stripe dashboard.

---

## Safety notes
- Never commit these values or paste them in chat. They belong only in Vercel + the
  Stripe dashboard + your password manager.
- If a key ever leaks, roll it: Stripe → API keys → roll the secret key, and
  regenerate the webhook secret, then update Vercel and redeploy.
- Test mode and Live mode have **separate** keys, prices, and webhooks. Don't mix them.
