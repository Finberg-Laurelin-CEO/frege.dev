import { z } from "zod";
import { getSql } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/prototype/email";
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
  passwordResetExpiresAt,
  passwordResetUrl,
} from "@/lib/prototype/password-reset";
import { checkRateLimit, rateLimitedResponse } from "@/lib/prototype/rate-limit";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestResetSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
});

type UserRow = {
  id: string;
  email: string;
  name: string;
};

const GENERIC_SUCCESS = { ok: true };

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = requestResetSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const email = parsed.data.email;
    const emailLimit = await checkRateLimit(req, {
      action: "auth.password.reset.request.email",
      limit: 5,
      windowSeconds: 60 * 60,
      keyParts: [email],
    });
    if (!emailLimit.allowed) return rateLimitedResponse(emailLimit);

    const ipLimit = await checkRateLimit(req, {
      action: "auth.password.reset.request.ip",
      limit: 20,
      windowSeconds: 60 * 60,
    });
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);

    const sql = getSql();
    const [user] = (await sql`
      select id, email, name
      from users
      where email = ${email}
        and status = 'active'
      limit 1
    `) as UserRow[];

    if (!user) return Response.json(GENERIC_SUCCESS, { status: 200 });

    const rawToken = generatePasswordResetToken();
    await sql`
      insert into user_password_reset_tokens (user_id, token_hash, expires_at)
      values (${user.id}, ${hashPasswordResetToken(rawToken)}, ${passwordResetExpiresAt().toISOString()})
    `;

    const emailResult = await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl: passwordResetUrl(rawToken),
    });

    await logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.password.reset.request",
      resourceType: "user",
      resourceId: user.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email_sent: emailResult.sent },
    });

    return Response.json(GENERIC_SUCCESS, { status: 200 });
  } catch (err) {
    return routeError("password reset request failed", err);
  }
}
