import { z } from "zod";
import { getSql } from "@/lib/db";
import { hashPassword } from "@/lib/prototype/password";
import { hashPasswordResetToken } from "@/lib/prototype/password-reset";
import { checkRateLimit, rateLimitedResponse } from "@/lib/prototype/rate-limit";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { createUserSession } from "@/lib/prototype/session";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmResetSchema = z
  .object({
    token: z.string().min(16).max(256),
    password: z.string().min(12, "Use at least 12 characters.").max(256),
    confirm_password: z.string().min(1, "Confirm your password.").max(256),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirm_password"],
        message: "Passwords must match.",
      });
    }
  });

type ResetTokenRow = {
  id: string;
  user_id: string;
  email: string;
  name: string;
};

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = confirmResetSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const tokenHash = hashPasswordResetToken(parsed.data.token);
    const limit = await checkRateLimit(req, {
      action: "auth.password.reset.confirm",
      limit: 10,
      windowSeconds: 10 * 60,
      keyParts: [tokenHash],
    });
    if (!limit.allowed) return rateLimitedResponse(limit);

    const sql = getSql();
    const [token] = (await sql`
      select
        user_password_reset_tokens.id,
        user_password_reset_tokens.user_id,
        users.email,
        users.name
      from user_password_reset_tokens
      join users on users.id = user_password_reset_tokens.user_id
      where user_password_reset_tokens.token_hash = ${tokenHash}
        and user_password_reset_tokens.used_at is null
        and user_password_reset_tokens.expires_at > now()
        and users.status = 'active'
      limit 1
    `) as ResetTokenRow[];

    if (!token) {
      await logTelemetryEvent({
        actor: { type: "system" },
        req,
        action: "auth.password.reset.confirm",
        outcome: "denied",
        latencyMs: Date.now() - startedAt,
      });
      return Response.json({ error: "invalid_or_expired_token" }, { status: 400 });
    }

    const nextPassword = await hashPassword(parsed.data.password);
    await sql`
      insert into user_password_credentials (user_id, password_hash, password_salt, password_params)
      values (${token.user_id}, ${nextPassword.passwordHash}, ${nextPassword.passwordSalt}, ${JSON.stringify(nextPassword.passwordParams)}::jsonb)
      on conflict (user_id) do update set
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        password_params = excluded.password_params,
        updated_at = now()
    `;
    await sql`
      update user_password_reset_tokens
      set used_at = now()
      where id = ${token.id}
    `;
    await sql`
      update user_password_reset_tokens
      set used_at = coalesce(used_at, now())
      where user_id = ${token.user_id}
        and used_at is null
        and id <> ${token.id}
    `;
    await sql`
      update user_sessions
      set status = 'revoked', revoked_at = now()
      where user_id = ${token.user_id}
        and status = 'active'
    `;

    const session = await createUserSession(token.user_id, req.headers.get("host"));
    await logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.password.reset.confirm",
      resourceType: "user",
      resourceId: token.user_id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
    });

    return Response.json(
      { ok: true, user: { id: token.user_id, email: token.email, name: token.name }, next_path: "/console" },
      { status: 200, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err) {
    return routeError("password reset confirm failed", err);
  }
}
