import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { recordPlatformAudit } from "@/lib/prototype/platform-audit";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusSchema = z.object({
  status: z.enum(["inactive", "active", "suspended"]),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = statusSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const { id } = await params;
    const sql = getSql();
    const [org] = await sql`
      update organizations
      set
        status = ${parsed.data.status},
        activated_at = case when ${parsed.data.status} = 'active' and activated_at is null then now() else activated_at end,
        suspended_at = case when ${parsed.data.status} = 'suspended' then now() else suspended_at end
      where id = ${id}
      returning id, slug, status, activated_at, suspended_at
    `;
    if (!org) return Response.json({ error: "not_found" }, { status: 404 });

    await logTelemetryEvent({
      actor: { type: "system", orgId: org.id },
      req,
      action: "platform.orgs.status",
      resourceType: "organization",
      resourceId: org.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { status: org.status, by_user: staff.auth.user.email },
    });

    await recordPlatformAudit(staff.auth, {
      action: "org.status",
      targetType: "organization",
      targetId: org.id,
      metadata: { status: org.status, slug: org.slug },
    });

    return Response.json({ organization: org }, { status: 200 });
  } catch (err) {
    return routeError("platform org status failed", err);
  }
}
