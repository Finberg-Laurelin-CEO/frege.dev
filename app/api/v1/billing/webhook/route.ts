import type Stripe from "stripe";
import { getSql } from "@/lib/db";
import { getStripe, getWebhookSecret, isStripeConfigured } from "@/lib/prototype/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function activateOrg(orgId: string, sub: {
  customerId?: string | null;
  subscriptionId?: string | null;
  status?: string | null;
  currentPeriodEnd?: number | null;
  seats?: number | null;
}) {
  const sql = getSql();
  await sql`
    insert into org_billing (
      org_id,
      stripe_customer_id,
      stripe_subscription_id,
      subscription_status,
      current_period_end,
      seats,
      updated_at
    )
    values (
      ${orgId}, ${sub.customerId ?? null}, ${sub.subscriptionId ?? null}, ${sub.status ?? null},
      ${sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd * 1000).toISOString() : null},
      ${sub.seats ?? 1}, now()
    )
    on conflict (org_id) do update set
      stripe_customer_id = coalesce(excluded.stripe_customer_id, org_billing.stripe_customer_id),
      stripe_subscription_id = coalesce(excluded.stripe_subscription_id, org_billing.stripe_subscription_id),
      subscription_status = excluded.subscription_status,
      current_period_end = coalesce(excluded.current_period_end, org_billing.current_period_end),
      seats = coalesce(${sub.seats ?? null}, org_billing.seats),
      updated_at = now()
  `;
  await sql`
    update organizations
    set status = 'active', activated_at = coalesce(activated_at, now())
    where id = ${orgId}
  `;
  await sql`
    update signups s
    set paid_at = coalesce(s.paid_at, now())
    from organization_invites i
    where s.invite_id = i.id
      and i.org_id = ${orgId}
      and s.paid_at is null
  `;
}

async function suspendOrgBySubscription(subscriptionId: string, status: string) {
  const sql = getSql();
  await sql`
    update org_billing set subscription_status = ${status}, updated_at = now()
    where stripe_subscription_id = ${subscriptionId}
  `;
  await sql`
    update organizations set status = 'suspended', suspended_at = now()
    where id in (select org_id from org_billing where stripe_subscription_id = ${subscriptionId})
  `;
}

export async function POST(req: Request) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "billing_unavailable" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing_signature" }, { status: 400 });

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, getWebhookSecret());
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.org_id ?? session.client_reference_id ?? null;
      if (orgId) {
        await activateOrg(orgId, {
          customerId: typeof session.customer === "string" ? session.customer : null,
          subscriptionId: typeof session.subscription === "string" ? session.subscription : null,
          status: "active",
          currentPeriodEnd: null,
        });
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = sub.metadata?.org_id ?? null;
      const active = sub.status === "active" || sub.status === "trialing";
      const seats = sub.items?.data?.[0]?.quantity ?? null;
      if (orgId && active) {
        await activateOrg(orgId, {
          customerId: typeof sub.customer === "string" ? sub.customer : null,
          subscriptionId: sub.id,
          status: sub.status,
          currentPeriodEnd: (sub as unknown as { current_period_end?: number }).current_period_end ?? null,
          seats,
        });
      } else if (!active) {
        await suspendOrgBySubscription(sub.id, sub.status);
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      await suspendOrgBySubscription(sub.id, "canceled");
    }

    return Response.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error("stripe webhook handler failed", { type: event.type, message: (err as Error)?.message });
    return Response.json({ error: "handler_failed" }, { status: 500 });
  }
}
