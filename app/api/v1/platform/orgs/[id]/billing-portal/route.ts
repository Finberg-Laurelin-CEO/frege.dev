import { getSql } from "@/lib/db";
import { appBaseUrl, getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { assertSafeBrowserMutation, routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    if (!isStripeConfigured()) {
      return Response.json({ error: "billing_unavailable" }, { status: 503 });
    }

    const { id } = await params;
    const sql = getSql();
    const [billing] = await sql`
      select stripe_customer_id from org_billing where org_id = ${id}
    `;
    const customerId = (billing?.stripe_customer_id as string | null | undefined) ?? null;
    if (!customerId) {
      return Response.json({ error: "no_subscription" }, { status: 409 });
    }

    const stripe = getStripe();
    const base = appBaseUrl(req);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}/platform`,
    });

    return Response.json({ portal_url: session.url }, { status: 200 });
  } catch (err) {
    return routeError("platform billing portal failed", err);
  }
}
