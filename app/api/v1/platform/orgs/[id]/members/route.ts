import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  user_id: z.string().uuid(),
  membership_status: z.enum(["active", "disabled"]),
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
    const parsed = patchSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const { id } = await params;
    const sql = getSql();
    const [membership] = await sql`
      update organization_memberships
      set status = ${parsed.data.membership_status}
      where org_id = ${id} and user_id = ${parsed.data.user_id}
      returning org_id, user_id, role, status
    `;
    if (!membership) return Response.json({ error: "not_found" }, { status: 404 });

    await logTelemetryEvent({
      actor: { type: "system", orgId: id },
      req,
      action: "platform.members.status",
      resourceType: "organization_membership",
      resourceId: parsed.data.user_id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { membership_status: membership.status, by_user: staff.auth.user.email },
    });

    return Response.json({ membership }, { status: 200 });
  } catch (err) {
    return routeError("platform member status failed", err);
  }
}
