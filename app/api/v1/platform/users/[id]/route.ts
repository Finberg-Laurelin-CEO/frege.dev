import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["active", "disabled"]),
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

    // Guard: don't let an operator disable their own account from here.
    if (id === staff.auth.user.id && parsed.data.status === "disabled") {
      return Response.json({ error: "cannot_disable_self" }, { status: 400 });
    }

    const sql = getSql();
    const [user] = await sql`
      update users
      set status = ${parsed.data.status}
      where id = ${id}
      returning id, email, status
    `;
    if (!user) return Response.json({ error: "not_found" }, { status: 404 });

    // Disabling a user kills their active sessions immediately.
    if (parsed.data.status === "disabled") {
      await sql`
        update user_sessions
        set status = 'revoked', revoked_at = now()
        where user_id = ${id} and status = 'active'
      `;
    }

    await logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "platform.users.status",
      resourceType: "user",
      resourceId: user.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { status: user.status, by_user: staff.auth.user.email },
    });

    return Response.json({ user }, { status: 200 });
  } catch (err) {
    return routeError("platform user status failed", err);
  }
}
