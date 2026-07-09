import type Stripe from "stripe";
import { getSql } from "@/lib/db";
import { handleBillingWebhook } from "@/lib/core/billing-webhook-core";
import { getStripe, getWebhookSecret, isStripeConfigured } from "@/lib/core/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "billing_unavailable" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing_signature" }, { status: 400 });

  const rawBody = await req.text();
  const stripe = getStripe();

  return handleBillingWebhook(
    { rawBody, signature, webhookSecret: getWebhookSecret() },
    {
      getSql,
      constructEvent: (body, sig, secret) => stripe.webhooks.constructEvent(body, sig, secret),
      retrieveSubscription: (subscriptionId) => stripe.subscriptions.retrieve(subscriptionId),
      listCheckoutSessionsBySubscription: async (subscriptionId) => {
        const sessions = await stripe.checkout.sessions.list({
          subscription: subscriptionId,
          limit: 1,
        } as Stripe.Checkout.SessionListParams);
        return sessions.data;
      },
      now: () => new Date(),
    },
  );
}
