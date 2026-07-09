import { z } from "zod";
import { getSql } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/core/password";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { authenticateUserRequest, revokeOtherUserSessions, userUnauthorized } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(256),
  new_password: z.string().min(12).max(256),
});

type CredentialRow = {
  password_hash: string;
  password_salt: string;
};

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const session = await authenticateUserRequest(req);
    if (!session) return userUnauthorized();

    const limit = await checkRateLimit(req, {
      action: "auth.password.change",
      limit: 5,
      windowSeconds: 10 * 60,
      keyParts: [session.user.id],
    });
    if (!limit.allowed) return rateLimitedResponse(limit);

    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = changePasswordSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const sql = getSql();
    const rows = await sql`
      select password_hash, password_salt
      from user_password_credentials
      where user_id = ${session.user.id}
      limit 1
    `;
    const credential = rows[0] as CredentialRow | undefined;
    if (!credential || !(await verifyPassword(parsed.data.current_password, credential.password_salt, credential.password_hash))) {
      await logTelemetryEvent({
        actor: { type: "system" },
        req,
        action: "auth.password.change",
        resourceType: "user",
        resourceId: session.user.id,
        outcome: "denied",
        latencyMs: Date.now() - startedAt,
      });
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }

    const nextPassword = await hashPassword(parsed.data.new_password);
    await sql`
      update user_password_credentials
      set password_hash = ${nextPassword.passwordHash},
          password_salt = ${nextPassword.passwordSalt},
          password_params = ${JSON.stringify(nextPassword.passwordParams)}::jsonb,
          updated_at = now()
      where user_id = ${session.user.id}
    `;
    await revokeOtherUserSessions(session.user.id, session.session.id);

    await logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.password.change",
      resourceType: "user",
      resourceId: session.user.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    return routeError("password change failed", err);
  }
}
