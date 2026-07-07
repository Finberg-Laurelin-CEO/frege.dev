import { getSql } from "@/lib/db";
import {
  emailVerificationUrlForToken,
  issueEmailVerificationToken,
  revokeOutstandingEmailVerificationTokens,
} from "@/lib/prototype/email-verification";
import { sendEmailVerificationEmail } from "@/lib/prototype/email";
import { checkRateLimit, rateLimitedResponse } from "@/lib/prototype/rate-limit";
import { assertSafeBrowserMutation, routeError } from "@/lib/prototype/request-guards";
import { authenticateUserRequest, userUnauthorized } from "@/lib/prototype/session";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const session = await authenticateUserRequest(req);
    if (!session) return userUnauthorized();

    if (session.user.email_verified_at) {
      return Response.json({ email_sent: false, verified: true }, { status: 200 });
    }

    const userLimit = await checkRateLimit(req, {
      action: "auth.email.verification.resend.user",
      limit: 3,
      windowSeconds: 60 * 60,
      keyParts: [session.user.id],
    });
    if (!userLimit.allowed) return rateLimitedResponse(userLimit);

    const ipLimit = await checkRateLimit(req, {
      action: "auth.email.verification.resend.ip",
      limit: 20,
      windowSeconds: 60 * 60,
    });
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);

    const sql = getSql();
    await revokeOutstandingEmailVerificationTokens(sql, session.user.id);
    const token = await issueEmailVerificationToken(sql, session.user.id);
    const emailResult = await sendEmailVerificationEmail({
      to: session.user.email,
      name: session.user.name,
      verificationUrl: emailVerificationUrlForToken(token.rawToken),
    });

    const orgId = session.memberships[0]?.org_id;
    await logTelemetryEvent({
      actor: { type: "system", orgId },
      req,
      action: "auth.email.verification.resend",
      resourceType: "user",
      resourceId: session.user.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email_sent: emailResult.sent },
    });

    return Response.json({ email_sent: emailResult.sent, verified: false }, { status: 200 });
  } catch (err) {
    return routeError("email verification resend failed", err);
  }
}
