import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { defaultAgentRoleStatements, normalizeEmail, slugifyOrg } from "@/lib/core/org-guard";
import { hashPassword } from "@/lib/core/password";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";
import { createUserSession } from "@/lib/core/session";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bootstrapSchema = z.object({
  token: z.string().min(1),
  email: z.string().email().max(320),
  password: z.string().min(12).max(256),
  name: z.string().trim().min(1).max(120),
  org_slug: z.string().trim().min(1).max(80).optional(),
  org_name: z.string().trim().min(1).max(160),
});

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const sql = getSql();
    const [userCount] = await sql`select count(*)::int as count from users`;
    if (Number((userCount as { count: number }).count) > 0) {
      return Response.json({ error: "bootstrap_closed" }, { status: 409 });
    }

    const limit = await checkRateLimit(req, {
      action: "auth.bootstrap",
      limit: 5,
      windowSeconds: 10 * 60,
    });
    if (!limit.allowed) return rateLimitedResponse(limit);

    const expectedToken = process.env.FREGE_BOOTSTRAP_TOKEN;
    if (!expectedToken) return Response.json({ error: "bootstrap_disabled" }, { status: 403 });

    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = bootstrapSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    if (parsed.data.token !== expectedToken) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    const email = normalizeEmail(parsed.data.email);
    const orgSlug = slugifyOrg(parsed.data.org_slug ?? parsed.data.org_name);
    const password = await hashPassword(parsed.data.password);

    // Atomic bootstrap: the neon HTTP driver runs sql.transaction([...]) as a
    // non-interactive batch (later statements cannot read earlier results), so
    // both ids are pre-generated client-side with crypto.randomUUID() — same
    // pattern as lib/core/billing-webhook-core.ts. A mid-batch failure leaves
    // no orphaned org/user rows behind.
    const orgId = randomUUID();
    const userId = randomUUID();
    const userName = parsed.data.name.trim();
    await sql.transaction([
      sql`
        insert into organizations (id, slug, name)
        values (${orgId}, ${orgSlug}, ${parsed.data.org_name})
      `,
      sql`
        insert into users (id, email, name)
        values (${userId}, ${email}, ${userName})
      `,
      sql`
        insert into user_password_credentials (user_id, password_hash, password_salt, password_params)
        values (${userId}, ${password.passwordHash}, ${password.passwordSalt}, ${JSON.stringify(password.passwordParams)}::jsonb)
      `,
      sql`
        insert into organization_memberships (org_id, user_id, role)
        values (${orgId}, ${userId}, 'owner')
      `,
      ...defaultAgentRoleStatements(sql, orgId),
    ]);

    // Session mint and telemetry stay outside the batch: they are side
    // effects that must only happen once the bootstrap rows are committed.
    const session = await createUserSession(userId, req.headers.get("host"));
    await logTelemetryEvent({
      actor: { type: "system", orgId },
      req,
      action: "auth.bootstrap",
      resourceType: "organization",
      resourceId: orgId,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { org_slug: orgSlug, user_email: email },
    });

    return Response.json(
      {
        user: { id: userId, email, name: userName },
        organization: { id: orgId, slug: orgSlug, name: parsed.data.org_name },
      },
      { status: 201, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err) {
    return routeError("bootstrap failed", err);
  }
}
