import { getSql } from "@/lib/db";
import {
  computeCustomerRevenueFromCharges,
  computeRecurringRevenue,
  getStripe,
  isStripeConfigured,
  type StripeCustomerRevenue,
} from "@/lib/core/billing";
import { authenticatePlatformStaff } from "@/lib/core/platform-auth";
import { routeError } from "@/lib/core/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StripePermissionError = { code?: string; type?: string };

type OrgBillingRevenueRow = {
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: string;
  plan: string | null;
  billing_interval: string | null;
  seats: number | null;
  subscription_status: string | null;
  stripe_customer_id: string | null;
};

function isPermissionError(err: unknown): boolean {
  const e = err as StripePermissionError;
  return e?.code === "api_key_insufficient_permissions" || e?.type === "invalid_request_error";
}

function emptyRevenue(): StripeCustomerRevenue {
  return {
    totalChargedCents: 0,
    totalRefundedCents: 0,
    netRevenueCents: 0,
    chargeCount: 0,
  };
}

function apiRevenue(revenue: StripeCustomerRevenue) {
  return {
    total_charged_cents: revenue.totalChargedCents,
    total_refunded_cents: revenue.totalRefundedCents,
    net_revenue_cents: revenue.netRevenueCents,
    charge_count: revenue.chargeCount,
  };
}

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    if (!isStripeConfigured()) {
      return Response.json({ error: "billing_unavailable" }, { status: 503 });
    }

    const sql = getSql();
    const rows = (await sql`
      select
        o.id as org_id,
        o.slug as org_slug,
        o.name as org_name,
        o.status as org_status,
        b.plan,
        b.billing_interval,
        b.seats,
        b.subscription_status,
        b.stripe_customer_id
      from organizations o
      left join org_billing b on b.org_id = o.id
      order by o.created_at desc
      limit 500
    `) as OrgBillingRevenueRow[];

    const customerIds = rows
      .map((row) => row.stripe_customer_id)
      .filter((id): id is string => Boolean(id));

    const stripe = getStripe();
    try {
      const [recurringRevenue, customerRevenue] = await Promise.all([
        computeRecurringRevenue(stripe),
        computeCustomerRevenueFromCharges(stripe, customerIds),
      ]);

      const organizations = rows
        .map((row) => {
          const revenue = row.stripe_customer_id
            ? customerRevenue.byCustomer.get(row.stripe_customer_id) ?? emptyRevenue()
            : emptyRevenue();
          return {
            org_id: row.org_id,
            org_slug: row.org_slug,
            org_name: row.org_name,
            org_status: row.org_status,
            plan: row.plan,
            billing_interval: row.billing_interval,
            seats: row.seats,
            subscription_status: row.subscription_status,
            stripe_customer_id: row.stripe_customer_id,
            ...apiRevenue(revenue),
          };
        })
        .sort((a, b) => b.net_revenue_cents - a.net_revenue_cents);

      return Response.json(
        {
          ...apiRevenue(customerRevenue.totals),
          mrr_cents: recurringRevenue.mrrCents,
          arr_cents: recurringRevenue.arrCents,
          active_subscriptions: recurringRevenue.activeSubscriptions,
          unmapped: apiRevenue(customerRevenue.unmapped),
          organizations,
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
    return routeError("platform revenue summary failed", err);
  }
}
