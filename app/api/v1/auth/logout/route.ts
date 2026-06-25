import { assertSafeBrowserMutation, routeError } from "@/lib/prototype/request-guards";
import { authenticateUserRequest, clearSessionCookie, revokeCurrentSession, userUnauthorized } from "@/lib/prototype/session";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const session = await authenticateUserRequest(req);
    if (!session) return userUnauthorized();

    await revokeCurrentSession(req);
    await logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.logout",
      resourceType: "user",
      resourceId: session.user.id,
      outcome: "success",
    });

    return Response.json({ ok: true }, { status: 200, headers: { "Set-Cookie": clearSessionCookie(req.headers.get("host")) } });
  } catch (err) {
    return routeError("logout failed", err);
  }
}
