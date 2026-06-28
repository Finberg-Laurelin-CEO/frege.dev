import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { sendInviteEmail } from "@/lib/prototype/email";
import { generateInviteToken, hashInviteToken, inviteLinkForToken } from "@/lib/prototype/invites";
import { normalizeEmail } from "@/lib/prototype/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inviteSchema = z.object({
  org_slug: z.string().min(1),
  email: z.string().email().max(320),
  role: z.enum(["owner", "admin", "member", "viewer"]).default("member"),
});

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
  const originError = assertSafeBrowserMutation(req);
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

    const email = normalizeEmail(parsed.data.email);
    const rawToken = generateInviteToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
    const sql = getSql();

    const [existingPendingInvite] = await sql`
      select id
      from organization_invites
      where org_id = ${auth.organization.id}
        and email = ${email}
        and status = 'pending'
      order by created_at desc
      limit 1
    `;

    const [invite] = existingPendingInvite
      ? await sql`
          update organization_invites
          set
            role = ${parsed.data.role},
            invited_by_user_id = ${auth.user.id},
            invite_token_hash = ${hashInviteToken(rawToken)},
            expires_at = ${expiresAt}
          where id = ${existingPendingInvite.id}
          returning id, email, role, status, expires_at, created_at
        `
      : await sql`
          insert into organization_invites (
            org_id, email, role, invited_by_user_id, invite_token_hash, expires_at
          ) values (
            ${auth.organization.id},
            ${email},
            ${parsed.data.role},
            ${auth.user.id},
            ${hashInviteToken(rawToken)},
            ${expiresAt}
          )
          returning id, email, role, status, expires_at, created_at
        `;

    const inviteLink = inviteLinkForToken(rawToken);
    const emailResult = await sendInviteEmail({
      to: invite.email,
      inviteUrl: inviteLink,
      orgName: auth.organization.name,
    });

    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: existingPendingInvite ? "admin.members.invite.resend" : "admin.members.invite",
      resourceType: "organization_invite",
      resourceId: invite.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: {
        email: invite.email,
        role: invite.role,
        email_sent: emailResult.sent,
        reissued: Boolean(existingPendingInvite),
      },
    });

    return Response.json(
      { invite, invite_token: rawToken, invite_link: inviteLink, email_sent: emailResult.sent, reissued: Boolean(existingPendingInvite) },
      { status: existingPendingInvite ? 200 : 201 },
    );
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return Response.json({ error: "duplicate_invite" }, { status: 409 });
    }
    return routeError("admin invite create failed", err);
  }
}
