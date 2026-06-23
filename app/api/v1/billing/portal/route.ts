import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { appBaseUrl, getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const portalSchema = z.object({
  org_slug: z.string().trim().min(1),
});

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    if (!isStripeConfigured()) {
      return Response.json({ error: "billing_unavailable" }, { status: 503 });
    }

    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = portalSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    // Only an org owner/admin can manage billing for their org.
    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;

    const sql = getSql();
    const [billing] = await sql`
      select stripe_customer_id from org_billing where org_id = ${auth.organization.id}
    `;
    const customerId = (billing?.stripe_customer_id as string | null | undefined) ?? null;
    if (!customerId) {
      return Response.json({ error: "no_subscription" }, { status: 409 });
    }

    const stripe = getStripe();
    const base = appBaseUrl(req);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}/billing?org=${encodeURIComponent(auth.organization.slug)}`,
    });

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "billing.portal.create",
      resourceType: "organization",
      resourceId: auth.organization.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
    });

    return Response.json({ portal_url: session.url }, { status: 200 });
  } catch (err) {
    return routeError("billing portal failed", err);
  }
}
