import { getSql } from "@/lib/db";
import { reissueInviteAndSendEmail } from "@/lib/prototype/invites";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { assertSafeBrowserMutation, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const { id } = await params;
    const sql = getSql();

    const [row] = await sql`
      select
        s.id as signup_id,
        i.id as invite_id,
        i.email,
        i.status as invite_status,
        o.id as org_id,
        o.name as org_name
      from signups s
      join organization_invites i on i.id = s.invite_id
      join organizations o on o.id = i.org_id
      where s.id = ${id}
      limit 1
    `;
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    if (row.invite_status === "accepted") {
      return Response.json({ error: "already_accepted" }, { status: 409 });
    }

    const { rawToken, inviteLink, emailResult } = await reissueInviteAndSendEmail(sql, {
      inviteId: row.invite_id,
      email: row.email,
      orgName: row.org_name,
    });

    await logTelemetryEvent({
      actor: { type: "system", orgId: row.org_id },
      req,
      action: "platform.signups.resend_invite",
      resourceType: "organization_invite",
      resourceId: row.invite_id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { signup_id: row.signup_id, by_user: staff.auth.user.email, email_sent: emailResult.sent },
    });

    return Response.json(
      {
        email_sent: emailResult.sent,
        invite_token: rawToken,
        invite_link: inviteLink,
      },
      { status: 200 },
    );
  } catch (err) {
    return routeError("platform signup resend invite failed", err);
  }
}
