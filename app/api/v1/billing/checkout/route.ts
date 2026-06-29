import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { appBaseUrl, getStripe, isStripeConfigured, planConfigs, type PlanKey } from "@/lib/prototype/billing";
import { billingSchemaResponse } from "@/lib/prototype/billing-errors";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  org_slug: z.string().trim().min(1),
  plan: z.enum(["solo", "team-monthly", "team-annual"]),
  seats: z.number().int().min(1).max(500).optional(),
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
    const parsed = checkoutSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    // Only an org owner/admin can start checkout for their org.
    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;

    const plans = planConfigs();
    const plan = plans[parsed.data.plan as PlanKey];
    if (!plan.priceId) {
      return Response.json({ error: "price_not_configured" }, { status: 503 });
    }

    const seats = plan.perSeat ? parsed.data.seats ?? 1 : 1;
    const stripe = getStripe();
    const base = appBaseUrl(req);
    const metadata = {
      org_id: auth.organization.id,
      org_slug: auth.organization.slug,
      plan: plan.plan,
      billing_interval: plan.interval,
      seats: String(seats),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      allow_promotion_codes: true,
      line_items: [{ price: plan.priceId, quantity: seats }],
      client_reference_id: auth.organization.id,
      customer_email: auth.user.email,
      success_url: `${base}/billing?status=success&org=${encodeURIComponent(auth.organization.slug)}`,
      cancel_url: `${base}/billing?status=cancelled&org=${encodeURIComponent(auth.organization.slug)}`,
      metadata,
      subscription_data: { metadata },
    });

    // Persist intended plan/seats so the webhook can reconcile.
    const sql = getSql();
    await sql`
      insert into org_billing (org_id, plan, billing_interval, seats, updated_at)
      values (${auth.organization.id}, ${plan.plan}, ${plan.interval}, ${seats}, now())
      on conflict (org_id) do update set
        plan = excluded.plan,
        billing_interval = excluded.billing_interval,
        seats = excluded.seats,
        updated_at = now()
    `;

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "billing.checkout.create",
      resourceType: "organization",
      resourceId: auth.organization.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { plan: plan.key, seats },
    });

    return Response.json({ checkout_url: session.url }, { status: 200 });
  } catch (err) {
    const schemaError = billingSchemaResponse("billing checkout storage missing", err);
    if (schemaError) return schemaError;
    return routeError("billing checkout failed", err);
  }
}
