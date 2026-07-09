import { getSql } from "@/lib/db";
import { verifyEmailVerificationToken } from "@/lib/core/email-verification";
import { customerAppBaseUrl } from "@/lib/core/public-url";
import { authenticateUserRequest } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appRedirect(path: string): Response {
  return Response.redirect(new URL(path, customerAppBaseUrl()), 303);
}

function accountPath(verified: string): string {
  return `/console?view=account&verified=${encodeURIComponent(verified)}`;
}

// This handler is reached by users clicking a link in an email: an unexpected
// failure (db timeout, etc.) must land them back on the console with an error
// state, never on a raw 500 page.
export async function GET(req: Request) {
  try {
    return await confirmEmailVerification(req);
  } catch (err) {
    console.error("email verification confirm failed", { message: (err as Error)?.message });
    return appRedirect(accountPath("error"));
  }
}

async function confirmEmailVerification(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const session = await authenticateUserRequest(req);

  if (!token) {
    const next = accountPath("invalid");
    return session
      ? appRedirect(next)
      : appRedirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const sql = getSql();
  const result = await verifyEmailVerificationToken(sql, token);

  if (!result.ok) {
    const next = accountPath(result.reason);
    return session
      ? appRedirect(next)
      : appRedirect(`/login?next=${encodeURIComponent(next)}`);
  }

  await logTelemetryEvent({
    actor: { type: "system", orgId: session?.memberships[0]?.org_id },
    req,
    action: "auth.email.verification.confirm",
    resourceType: "user",
    resourceId: result.userId,
    outcome: "success",
    latencyMs: Date.now() - startedAt,
    metadata: { already_verified: result.alreadyVerified },
  });

  const next = accountPath("1");
  return session
    ? appRedirect(next)
    : appRedirect(`/login?next=${encodeURIComponent(next)}`);
}
