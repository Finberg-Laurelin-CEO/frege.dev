import { getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StripePermissionError = { code?: string; type?: string };

function isPermissionError(err: unknown): boolean {
  const e = err as StripePermissionError;
  return e?.code === "api_key_insufficient_permissions" || e?.type === "invalid_request_error";
}

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    if (!isStripeConfigured()) {
      return Response.json({ error: "billing_unavailable" }, { status: 503 });
    }

    const stripe = getStripe();

    // Active subscriptions → MRR. Normalize all intervals to a monthly figure.
    let mrrCents = 0;
    let activeSubscriptions = 0;
    let pastDueSubscriptions = 0;
    try {
      for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
        if (sub.status === "active" || sub.status === "trialing") {
          activeSubscriptions += 1;
          for (const item of sub.items.data) {
            const price = item.price;
            const qty = item.quantity ?? 1;
            const amount = (price.unit_amount ?? 0) * qty;
            const interval = price.recurring?.interval;
            const count = price.recurring?.interval_count ?? 1;
            if (interval === "year") mrrCents += amount / (12 * count);
            else if (interval === "week") mrrCents += (amount * 52) / (12 * count);
            else if (interval === "day") mrrCents += (amount * 365) / (12 * count);
            else mrrCents += amount / count; // month
          }
        }
        if (sub.status === "past_due" || sub.status === "unpaid") pastDueSubscriptions += 1;
      }
    } catch (err) {
      if (isPermissionError(err)) {
        return Response.json({ error: "insufficient_stripe_permission" }, { status: 502 });
      }
      throw err;
    }

    // Recent charges.
    const charges = await stripe.charges.list({ limit: 10 });
    const recentCharges = charges.data.map((c) => ({
      id: c.id,
      amount: c.amount,
      currency: c.currency,
      status: c.status,
      refunded: c.refunded,
      description: c.description,
      created: new Date(c.created * 1000).toISOString(),
      customer_email: c.billing_details?.email ?? c.receipt_email ?? null,
    }));

    // Failed / past-due invoices needing attention.
    const failed = await stripe.invoices.list({ status: "open", limit: 10 });
    const openInvoices = failed.data
      .filter((inv) => (inv.attempt_count ?? 0) > 0 || inv.status === "open")
      .map((inv) => ({
        id: inv.id,
        amount_due: inv.amount_due,
        currency: inv.currency,
        status: inv.status,
        attempt_count: inv.attempt_count,
        customer_email: inv.customer_email,
        hosted_invoice_url: inv.hosted_invoice_url,
        created: new Date(inv.created * 1000).toISOString(),
      }));

    // Payout status on the connected/own account.
    let payout: { enabled: boolean; disabled_reason: string | null } | null = null;
    try {
      const account = await stripe.accounts.retrieveCurrent();
      payout = {
        enabled: account.payouts_enabled ?? false,
        disabled_reason:
          (account.requirements?.disabled_reason as string | null | undefined) ?? null,
      };
    } catch {
      payout = null; // restricted key may lack account read; non-fatal.
    }

    return Response.json(
      {
        mrr_cents: Math.round(mrrCents),
        active_subscriptions: activeSubscriptions,
        past_due_subscriptions: pastDueSubscriptions,
        recent_charges: recentCharges,
        open_invoices: openInvoices,
        payout,
      },
      { status: 200 },
    );
  } catch (err) {
    return routeError("platform payments overview failed", err);
  }
}
