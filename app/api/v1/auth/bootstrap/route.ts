import { z } from "zod";
import { getSql } from "@/lib/db";
import { ensureDefaultAgentRoles, normalizeEmail, slugifyOrg } from "@/lib/prototype/org-guard";
import { hashPassword } from "@/lib/prototype/password";
import { assertSafeOrigin, readJson, routeError } from "@/lib/prototype/request-guards";
import { createUserSession } from "@/lib/prototype/session";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

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

    const sql = getSql();
    const [userCount] = await sql`select count(*)::int as count from users`;
    if (Number((userCount as { count: number }).count) > 0) {
      return Response.json({ error: "already_bootstrapped" }, { status: 409 });
    }

    const email = normalizeEmail(parsed.data.email);
    const orgSlug = slugifyOrg(parsed.data.org_slug ?? parsed.data.org_name);
    const password = await hashPassword(parsed.data.password);

    const [org] = await sql`
      insert into organizations (slug, name)
      values (${orgSlug}, ${parsed.data.org_name})
      returning id, slug, name
    `;
    const [user] = await sql`
      insert into users (email, name)
      values (${email}, ${parsed.data.name.trim()})
      returning id, email, name
    `;
    await sql`
      insert into user_password_credentials (user_id, password_hash, password_salt, password_params)
      values (${user.id}, ${password.passwordHash}, ${password.passwordSalt}, ${JSON.stringify(password.passwordParams)}::jsonb)
    `;
    await sql`
      insert into organization_memberships (org_id, user_id, role)
      values (${org.id}, ${user.id}, 'owner')
    `;
    await ensureDefaultAgentRoles(org.id);

    const session = await createUserSession(user.id);
    await logTelemetryEvent({
      actor: { type: "system", orgId: org.id },
      req,
      action: "auth.bootstrap",
      resourceType: "organization",
      resourceId: org.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { org_slug: org.slug, user_email: email },
    });

    return Response.json(
      { user: { id: user.id, email: user.email, name: user.name }, organization: org },
      { status: 201, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err) {
    return routeError("bootstrap failed", err);
  }
}
