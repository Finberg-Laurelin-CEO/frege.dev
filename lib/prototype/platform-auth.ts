import { getSql } from "@/lib/db";
import { authenticateUserRequest, type UserSessionContext } from "@/lib/prototype/session";

export type PlatformStaffContext = {
  user: UserSessionContext["user"];
  session: UserSessionContext["session"];
};

export type PlatformAuthResult =
  | { ok: true; auth: PlatformStaffContext }
  | { ok: false; response: Response };

// Cross-org operator access. Requires a valid user session AND users.is_platform_staff = true.
export async function authenticatePlatformStaff(req: Request): Promise<PlatformAuthResult> {
  const session = await authenticateUserRequest(req);
  if (!session) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const sql = getSql();
  const [row] = await sql`
    select is_platform_staff
    from users
    where id = ${session.user.id}
    limit 1
  `;

  if (!row || (row as { is_platform_staff: boolean }).is_platform_staff !== true) {
    return { ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) };
  }

  return {
    ok: true,
    auth: { user: session.user, session: session.session },
  };
}
