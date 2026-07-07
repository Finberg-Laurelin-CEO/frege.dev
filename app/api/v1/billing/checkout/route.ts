import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { appBaseUrl, createCheckoutSession, isStripeConfigured } from "@/lib/prototype/billing";
import { billingSchemaResponse } from "@/lib/prototype/billing-errors";
import { assertVerifiedHumanUser } from "@/lib/prototype/org-guard";
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
    const unverified = assertVerifiedHumanUser(auth);
    if (unverified) return unverified;

    const checkout = await createCheckoutSession({
      organization: auth.organization,
      user: auth.user,
      planKey: parsed.data.plan,
      seats: parsed.data.seats,
      baseUrl: appBaseUrl(req),
    });

    // Persist intended plan/seats so the webhook can reconcile.
    const sql = getSql();
    await sql`
      insert into org_billing (org_id, plan, billing_interval, seats, updated_at)
      values (${auth.organization.id}, ${checkout.plan.plan}, ${checkout.plan.interval}, ${checkout.seats}, now())
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
      metadata: { plan: checkout.plan.key, seats: checkout.seats },
    });

    return Response.json({ checkout_url: checkout.session.url }, { status: 200 });
  } catch (err) {
    const schemaError = billingSchemaResponse("billing checkout storage missing", err);
    if (schemaError) return schemaError;
    return routeError("billing checkout failed", err);
  }
}
