import { getSql } from "@/lib/db";
import { authenticateUserRequest, userUnauthorized } from "@/lib/core/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connected sign-ins for the session user: which OAuth providers (google /
// github) are bound to this account via user_identities. Backs the console's
// "Connected sign-ins" block.
export async function GET(req: Request) {
  const session = await authenticateUserRequest(req);
  if (!session) return userUnauthorized();

  const sql = getSql();
  const rows = await sql`
    select provider
    from user_identities
    where user_id = ${session.user.id}
    order by provider asc
  `;

  return Response.json(
    { providers: rows.map((row) => String((row as { provider: string }).provider)) },
    { status: 200 },
  );
}
