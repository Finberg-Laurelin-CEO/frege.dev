import { z } from "zod";
import { getSql } from "@/lib/db";
import { hashFreeActivationCode, normalizeFreeActivationCode } from "@/lib/prototype/free-codes";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const redeemSchema = z.object({
  org_slug: z.string().trim().min(1),
  code: z.string().trim().min(6).max(120),
});

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = redeemSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;

    const normalizedCode = normalizeFreeActivationCode(parsed.data.code);
    if (normalizedCode.length < 12) {
      return Response.json({ error: "invalid_code" }, { status: 404 });
    }

    const codeHash = hashFreeActivationCode(parsed.data.code);
    const sql = getSql();

    const [redeemed] = await sql`
      with redeemed_code as (
        update free_activation_codes c
        set
          status = 'redeemed',
          redeemed_org_id = ${auth.organization.id},
          redeemed_by_user_id = ${auth.user.id},
          redeemed_by_email = ${auth.user.email},
          redeemed_at = now()
        where c.code_hash = ${codeHash}
          and c.status = 'active'
          and c.revoked_at is null
          and c.redeemed_at is null
          and exists (
            select 1
            from organizations o
            where o.id = ${auth.organization.id}
              and o.status = 'inactive'
          )
        returning c.id, c.label, c.plan, c.billing_interval, c.seats
      ),
      activated_org as (
        update organizations o
        set status = 'active', activated_at = coalesce(o.activated_at, now())
        where o.id = ${auth.organization.id}
          and exists (select 1 from redeemed_code)
        returning o.id, o.slug, o.name, o.status, o.activated_at
      ),
      billing as (
        insert into org_billing (
          org_id,
          plan,
          billing_interval,
          seats,
          subscription_status,
          entitlement_kind,
          entitlement_status,
          comp_activation_code_id,
          comp_activated_by_user_id,
          comp_activated_at,
          updated_at
        )
        select
          ${auth.organization.id},
          r.plan,
          r.billing_interval,
          r.seats,
          'comp',
          'comp',
          'active',
          r.id,
          ${auth.user.id},
          now(),
          now()
        from redeemed_code r
        join activated_org o on true
        on conflict (org_id) do update set
          plan = excluded.plan,
          billing_interval = excluded.billing_interval,
          seats = excluded.seats,
          subscription_status = excluded.subscription_status,
          entitlement_kind = excluded.entitlement_kind,
          entitlement_status = excluded.entitlement_status,
          comp_activation_code_id = excluded.comp_activation_code_id,
          comp_activated_by_user_id = excluded.comp_activated_by_user_id,
          comp_activated_at = excluded.comp_activated_at,
          updated_at = now()
        returning org_id, entitlement_kind, entitlement_status
      )
      select
        r.id as code_id,
        r.label as code_label,
        r.plan,
        r.billing_interval,
        r.seats,
        o.id as org_id,
        o.slug as org_slug,
        o.name as org_name,
        o.status as org_status,
        o.activated_at,
        b.entitlement_kind,
        b.entitlement_status
      from redeemed_code r
      join activated_org o on true
      join billing b on true
    `;

    if (!redeemed) {
      const [code] = await sql`
        select status, revoked_at, redeemed_at
        from free_activation_codes
        where code_hash = ${codeHash}
        limit 1
      `;
      if (!code) return Response.json({ error: "invalid_code" }, { status: 404 });
      const status = (code as { status: string; revoked_at: string | null; redeemed_at: string | null }).status;
      if (status === "revoked") return Response.json({ error: "code_revoked" }, { status: 409 });
      if (status === "redeemed") return Response.json({ error: "code_redeemed" }, { status: 409 });

      const [org] = await sql`
        select status from organizations where id = ${auth.organization.id} limit 1
      `;
      if (org && (org as { status: string }).status !== "inactive") {
        return Response.json({ error: "org_not_inactive" }, { status: 409 });
      }
      return Response.json({ error: "code_not_redeemable" }, { status: 409 });
    }

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "billing.free_code.redeem",
      resourceType: "organization",
      resourceId: auth.organization.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: {
        code_id: redeemed.code_id,
        plan: redeemed.plan,
        billing_interval: redeemed.billing_interval,
        seats: redeemed.seats,
      },
    });

    return Response.json({ activation: redeemed }, { status: 200 });
  } catch (err) {
    return routeError("billing free code redeem failed", err);
  }
}
