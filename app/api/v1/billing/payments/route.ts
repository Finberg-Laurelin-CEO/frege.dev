import type Stripe from "stripe";
import { getSql } from "@/lib/db";
import { billingSchemaResponse } from "@/lib/prototype/billing-errors";
import { getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { getMembershipForOrg } from "@/lib/prototype/org-guard";
import { authenticateUserRequest, userUnauthorized } from "@/lib/prototype/session";
import { routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// User-facing billing detail: the live subscription, default card, and invoice
// history for the caller's org. Owner/admin only (canManageOrg) since invoices
// expose payment amounts. Mirrors the platform payments route's Stripe calls,
// but scoped to the authenticated user's membership.
export async function GET(req: Request) {
  try {
    const session = await authenticateUserRequest(req);
    if (!session) return userUnauthorized();

    const url = new URL(req.url);
    const orgSlug = url.searchParams.get("org_slug") ?? session.memberships[0]?.org_slug;
    if (!orgSlug) return Response.json({ error: "missing_org" }, { status: 400 });

    const auth = getMembershipForOrg(session, orgSlug);
    if (!auth) return Response.json({ error: "forbidden_org" }, { status: 403 });
    if (!auth.capabilities.canManageOrg) return Response.json({ error: "forbidden_billing" }, { status: 403 });

    if (!isStripeConfigured()) {
      return Response.json({ subscription: null, card: null, invoices: [], stripe_unconfigured: true }, { status: 200 });
    }

    const sql = getSql();
    const [billing] = (await sql`
      select stripe_customer_id, stripe_subscription_id
      from org_billing where org_id = ${auth.organization.id}
      limit 1
    `) as { stripe_customer_id: string | null; stripe_subscription_id: string | null }[];

    const customerId = billing?.stripe_customer_id ?? null;
    if (!customerId) {
      return Response.json({ subscription: null, card: null, invoices: [] }, { status: 200 });
    }

    const stripe = getStripe();
    const subId = billing?.stripe_subscription_id ?? null;

    const [subscription, invoiceList, customer] = await Promise.all([
      subId ? stripe.subscriptions.retrieve(subId).catch(() => null) : Promise.resolve(null),
      stripe.invoices.list({ customer: customerId, limit: 12 }).catch(() => null),
      stripe.customers
        .retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] })
        .catch(() => null),
    ]);

    const item = subscription?.items.data[0] ?? null;
    const price = item?.price ?? null;

    let card: { brand: string; last4: string; exp_month: number; exp_year: number } | null = null;
    if (customer && !("deleted" in customer && customer.deleted)) {
      const pm = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
      if (pm && typeof pm !== "string" && pm.card) {
        card = { brand: pm.card.brand, last4: pm.card.last4, exp_month: pm.card.exp_month, exp_year: pm.card.exp_year };
      }
    }

    const invoices = (invoiceList?.data ?? []).map((inv) => ({
      id: inv.id,
      number: inv.number,
      amount: inv.amount_paid || inv.amount_due || inv.total,
      currency: inv.currency,
      status: inv.status,
      hosted_invoice_url: inv.hosted_invoice_url,
      invoice_pdf: inv.invoice_pdf,
      created: new Date(inv.created * 1000).toISOString(),
    }));

    return Response.json(
      {
        subscription: subscription
          ? {
              status: subscription.status,
              cancel_at_period_end: subscription.cancel_at_period_end,
              current_period_end: item?.current_period_end
                ? new Date(item.current_period_end * 1000).toISOString()
                : null,
              interval: price?.recurring?.interval ?? null,
              amount_cents: typeof price?.unit_amount === "number" ? price.unit_amount : null,
              quantity: item?.quantity ?? 1,
              currency: price?.currency ?? "usd",
            }
          : null,
        card,
        invoices,
      },
      { status: 200 },
    );
  } catch (err) {
    const schemaError = billingSchemaResponse("billing payments storage missing", err);
    if (schemaError) return schemaError;
    return routeError("billing payments failed", err);
  }
}
