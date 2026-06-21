import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { normalizeEmail } from "@/lib/prototype/org-guard";
import { assertSafeOrigin, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inviteSchema = z.object({
  org_slug: z.string().min(1),
  email: z.string().email().max(320),
  role: z.enum(["owner", "admin", "member", "viewer"]).default("member"),
});

function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;
    const sql = getSql();
    const [members, invites] = await Promise.all([
      sql`
        select users.id, users.email, users.name, organization_memberships.role, organization_memberships.status, organization_memberships.created_at
        from organization_memberships
        join users on users.id = organization_memberships.user_id
        where organization_memberships.org_id = ${auth.organization.id}
        order by users.email asc
      `,
      sql`
        select id, email, role, status, expires_at, created_at
        from organization_invites
        where org_id = ${auth.organization.id}
        order by created_at desc
        limit 50
      `,
    ]);

    return Response.json({ members, invites }, { status: 200 });
  } catch (err) {
    return routeError("admin members list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = inviteSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;

    const rawToken = randomBytes(24).toString("base64url");
    const sql = getSql();
    const [invite] = await sql`
      insert into organization_invites (
        org_id, email, role, invited_by_user_id, invite_token_hash, expires_at
      ) values (
        ${auth.organization.id},
        ${normalizeEmail(parsed.data.email)},
        ${parsed.data.role},
        ${auth.user.id},
        ${hashInviteToken(rawToken)},
        ${new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()}
      )
      returning id, email, role, status, expires_at, created_at
    `;

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.members.invite",
      resourceType: "organization_invite",
      resourceId: invite.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email: invite.email, role: invite.role },
    });

    return Response.json({ invite, invite_token: rawToken }, { status: 201 });
  } catch (err) {
    return routeError("admin invite create failed", err);
  }
}
