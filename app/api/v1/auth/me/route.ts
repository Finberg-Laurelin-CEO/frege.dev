import { authenticateUserRequest, userUnauthorized } from "@/lib/prototype/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await authenticateUserRequest(req);
  if (!session) return userUnauthorized();

  return Response.json(session, { status: 200 });
}
