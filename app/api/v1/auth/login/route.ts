import { z } from "zod";
import { getSql } from "@/lib/db";
import { normalizeEmail } from "@/lib/prototype/org-guard";
import { verifyPassword } from "@/lib/prototype/password";
import { checkRateLimit, rateLimitedResponse } from "@/lib/prototype/rate-limit";
import { assertSafeOrigin, readJson, routeError } from "@/lib/prototype/request-guards";
import { createUserSession } from "@/lib/prototype/session";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

type LoginRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  password_salt: string;
};

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = loginSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const email = normalizeEmail(parsed.data.email);
    const limit = await checkRateLimit(req, {
      action: "auth.login",
      limit: 10,
      windowSeconds: 10 * 60,
      keyParts: [email],
    });
    if (!limit.allowed) return rateLimitedResponse(limit);

    const sql = getSql();
    const rows = await sql`
      select users.id, users.email, users.name, creds.password_hash, creds.password_salt
      from users
      join user_password_credentials creds on creds.user_id = users.id
      where users.email = ${email}
        and users.status = 'active'
      limit 1
    `;

    const row = rows[0] as LoginRow | undefined;
    if (!row || !(await verifyPassword(parsed.data.password, row.password_salt, row.password_hash))) {
      await logTelemetryEvent({
        actor: { type: "system" },
        req,
        action: "auth.login",
        outcome: "denied",
        latencyMs: Date.now() - startedAt,
        metadata: { email },
      });
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }

    await sql`update users set last_login_at = now() where id = ${row.id}`;
    const session = await createUserSession(row.id);

    await logTelemetryEvent({
      actor: { type: "system" },
      req,
      action: "auth.login",
      resourceType: "user",
      resourceId: row.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email },
    });

    return Response.json(
      { user: { id: row.id, email: row.email, name: row.name } },
      { status: 200, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err) {
    return routeError("login failed", err);
  }
}
