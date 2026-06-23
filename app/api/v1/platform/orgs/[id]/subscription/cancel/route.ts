import { getSql } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { recordPlatformAudit } from "@/lib/prototype/platform-audit";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";

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
    const body = await readJson(req);
    const immediate =
      body.ok && typeof body.value === "object" && body.value !== null
        ? (body.value as { immediate?: boolean }).immediate === true
        : false;

    const sql = getSql();
    const [billing] = await sql`
      select stripe_subscription_id from org_billing where org_id = ${id}
    `;
    const subId = (billing?.stripe_subscription_id as string | null | undefined) ?? null;
    if (!subId) {
      return Response.json({ error: "no_subscription" }, { status: 409 });
    }

    const stripe = getStripe();
    const updated = immediate
      ? await stripe.subscriptions.cancel(subId)
      : await stripe.subscriptions.update(subId, { cancel_at_period_end: true });

    await recordPlatformAudit(staff.auth, {
      action: "subscription.cancel",
      targetType: "organization",
      targetId: id,
      metadata: { subscription_id: subId, immediate, status: updated.status },
    });

    return Response.json(
      { status: updated.status, cancel_at_period_end: updated.cancel_at_period_end },
      { status: 200 },
    );
  } catch (err) {
    return routeError("platform subscription cancel failed", err);
  }
}
