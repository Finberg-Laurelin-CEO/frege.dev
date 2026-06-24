import { getSql } from "@/lib/db";
import { computeRecurringRevenue, getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StripePermissionError = { code?: string; type?: string };

function isPermissionError(err: unknown): boolean {
  const e = err as StripePermissionError;
  return e?.code === "api_key_insufficient_permissions" || e?.type === "invalid_request_error";
}

function parseChargeLimit(req: Request): number {
  const raw = new URL(req.url).searchParams.get("limit");
  const parsed = raw ? Number.parseInt(raw, 10) : 10;
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(parsed, 100));
}

function stripeCustomerId(customer: unknown): string | null {
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) {
    const id = (customer as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    if (!isStripeConfigured()) {
      return Response.json({ error: "billing_unavailable" }, { status: 503 });
    }

    const stripe = getStripe();
    const chargeLimit = parseChargeLimit(req);
    const sql = getSql();

    try {
      const recurringRevenue = await computeRecurringRevenue(stripe);

      const orgRows = await sql`
        select
          b.stripe_customer_id,
          o.id as org_id,
          o.slug as org_slug,
          o.name as org_name
        from org_billing b
        join organizations o on o.id = b.org_id
        where b.stripe_customer_id is not null
      `;
      const orgByCustomer = new Map(
        (orgRows as Array<{
          stripe_customer_id: string;
          org_id: string;
          org_slug: string;
          org_name: string;
        }>).map((row) => [row.stripe_customer_id, row]),
      );

      // Recent charges.
      const charges = await stripe.charges.list({ limit: chargeLimit });
      const recentCharges = charges.data.map((c) => {
        const customerId = stripeCustomerId(c.customer);
        const org = customerId ? orgByCustomer.get(customerId) : null;
        return {
          id: c.id,
          amount: c.amount,
          currency: c.currency,
          status: c.status,
          refunded: c.refunded,
          description: c.description,
          created: new Date(c.created * 1000).toISOString(),
          customer_id: customerId,
          customer_email: c.billing_details?.email ?? c.receipt_email ?? null,
          org_id: org?.org_id ?? null,
          org_slug: org?.org_slug ?? null,
          org_name: org?.org_name ?? null,
        };
      });

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
          mrr_cents: recurringRevenue.mrrCents,
          arr_cents: recurringRevenue.arrCents,
          active_subscriptions: recurringRevenue.activeSubscriptions,
          past_due_subscriptions: recurringRevenue.pastDueSubscriptions,
          recent_charges: recentCharges,
          open_invoices: openInvoices,
          payout,
        },
        { status: 200 },
      );
    } catch (err) {
      if (isPermissionError(err)) {
        return Response.json({ error: "insufficient_stripe_permission" }, { status: 502 });
      }
      throw err;
    }
  } catch (err) {
    return routeError("platform payments overview failed", err);
  }
}
