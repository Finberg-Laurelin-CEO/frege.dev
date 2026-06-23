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
    const amount =
      body.ok && typeof body.value === "object" && body.value !== null
        ? (body.value as { amount?: number }).amount
        : undefined;

    const stripe = getStripe();
    const refund = await stripe.refunds.create({
      charge: id,
      ...(typeof amount === "number" && amount > 0 ? { amount } : {}),
    });

    await recordPlatformAudit(staff.auth, {
      action: "charge.refund",
      targetType: "charge",
      targetId: id,
      metadata: { refund_id: refund.id, amount: refund.amount, status: refund.status },
    });

    return Response.json(
      { refund_id: refund.id, amount: refund.amount, status: refund.status },
      { status: 200 },
    );
  } catch (err) {
    return routeError("platform charge refund failed", err);
  }
}
