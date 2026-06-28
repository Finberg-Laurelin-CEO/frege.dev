import { getSql } from "@/lib/db";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { recordPlatformAudit } from "@/lib/prototype/platform-audit";
import { assertSafeBrowserMutation, routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const { id } = await params;
    const sql = getSql();
    const [code] = await sql`
      update free_activation_codes
      set
        status = 'revoked',
        revoked_by_user_id = ${staff.auth.user.id},
        revoked_by_email = ${staff.auth.user.email},
        revoked_at = now()
      where id = ${id}
        and status = 'active'
        and redeemed_at is null
      returning
        id,
        label,
        status,
        plan,
        billing_interval,
        seats,
        created_by_email,
        created_at,
        revoked_by_email,
        revoked_at
    `;

    if (!code) {
      return Response.json({ error: "not_found_or_not_revokeable" }, { status: 409 });
    }

    await recordPlatformAudit(staff.auth, {
      action: "free_code.revoke",
      targetType: "free_activation_code",
      targetId: code.id,
      metadata: { label: code.label },
    });

    return Response.json({ free_code: code }, { status: 200 });
  } catch (err) {
    return routeError("platform free code revoke failed", err);
  }
}
