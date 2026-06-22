import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSignupSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "contacted", "qualified", "disqualified"]),
  notes: z.string().max(2000).optional(),
  disqualified_reason: z.string().max(1000).optional(),
});

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;

    const sql = getSql();
    const signups = await sql`
      select
        signups.id,
        signups.created_at,
        signups.name,
        signups.work_email,
        signups.company,
        signups.role,
        signups.company_size,
        signups.expected_users,
        signups.current_agent_tools,
        signups.monthly_ai_spend,
        signups.willing_to_pay,
        signups.decision_timeline,
        signups.main_pain_point,
        signups.other_comments,
        signups.status,
        signups.contacted_at,
        signups.qualified_at,
        signups.notes,
        signups.disqualified_reason,
        users.email as owner_user_email
      from signups
      left join users on users.id = signups.owner_user_id
      order by signups.created_at desc
      limit 100
    `;

    return Response.json({ signups }, { status: 200 });
  } catch (err) {
    return routeError("admin signups list failed", err);
  }
}

export async function PATCH(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = updateSignupSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;

    const sql = getSql();
    const [signup] = await sql`
      update signups
      set status = ${parsed.data.status},
          owner_user_id = ${auth.user.id},
          contacted_at = case when ${parsed.data.status} = 'contacted' and contacted_at is null then now() else contacted_at end,
          qualified_at = case when ${parsed.data.status} = 'qualified' and qualified_at is null then now() else qualified_at end,
          notes = coalesce(${parsed.data.notes ?? null}, notes),
          disqualified_reason = coalesce(${parsed.data.disqualified_reason ?? null}, disqualified_reason)
      where id = ${parsed.data.id}
      returning id, work_email, company, status
    `;

    if (!signup) return Response.json({ error: "not_found" }, { status: 404 });

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.signups.update",
      resourceType: "signup",
      resourceId: signup.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { status: signup.status, company: signup.company },
    });

    return Response.json({ signup }, { status: 200 });
  } catch (err) {
    return routeError("admin signup update failed", err);
  }
}
