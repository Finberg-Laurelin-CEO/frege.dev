import { getSql } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    if (!isStripeConfigured()) {
      return Response.json({ error: "billing_unavailable" }, { status: 503 });
    }

    const { id } = await params;
    const sql = getSql();
    const [billing] = await sql`
      select stripe_customer_id, stripe_subscription_id
      from org_billing where org_id = ${id}
    `;
    const customerId = (billing?.stripe_customer_id as string | null | undefined) ?? null;
    if (!customerId) {
      return Response.json(
        { customer: null, subscription: null, charges: [], invoices: [] },
        { status: 200 },
      );
    }

    const stripe = getStripe();
    const subId = (billing?.stripe_subscription_id as string | null | undefined) ?? null;

    const [subscription, charges, invoices] = await Promise.all([
      subId
        ? stripe.subscriptions.retrieve(subId).catch(() => null)
        : Promise.resolve(null),
      stripe.charges.list({ customer: customerId, limit: 10 }),
      stripe.invoices.list({ customer: customerId, limit: 10 }),
    ]);

    return Response.json(
      {
        customer: customerId,
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              current_period_end: subscription.items.data[0]?.current_period_end
                ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
                : null,
              cancel_at_period_end: subscription.cancel_at_period_end,
            }
          : null,
        charges: charges.data.map((c) => ({
          id: c.id,
          amount: c.amount,
          currency: c.currency,
          status: c.status,
          refunded: c.refunded,
          created: new Date(c.created * 1000).toISOString(),
        })),
        invoices: invoices.data.map((inv) => ({
          id: inv.id,
          amount_due: inv.amount_due,
          status: inv.status,
          currency: inv.currency,
          hosted_invoice_url: inv.hosted_invoice_url,
          created: new Date(inv.created * 1000).toISOString(),
        })),
      },
      { status: 200 },
    );
  } catch (err) {
    return routeError("platform org payments failed", err);
  }
}
