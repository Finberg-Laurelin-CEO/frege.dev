import { z } from "zod";
import { getSql } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/prototype/admin-auth";
import { sendInviteEmail } from "@/lib/prototype/email";
import { generateInviteToken, hashInviteToken, inviteLinkForToken } from "@/lib/prototype/invites";
import { assertActiveHumanOrg, normalizeEmail } from "@/lib/prototype/org-guard";
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
    const inactive = assertActiveHumanOrg(auth);
    if (inactive) return inactive;

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

    const [existingMember] = await sql`
      select 1
      from organization_memberships
      join users on users.id = organization_memberships.user_id
      where organization_memberships.org_id = ${auth.organization.id}
        and users.email = ${email}
        and organization_memberships.status = 'active'
      limit 1
    `;
    if (existingMember) return Response.json({ error: "already_member" }, { status: 409 });

    const [limits] = await sql`
      select
        coalesce((select plan from org_billing where org_id = ${auth.organization.id}), 'solo') as plan,
        coalesce((select seats from org_billing where org_id = ${auth.organization.id}), 1)::int as seats,
        (select count(*)::int from organization_memberships where org_id = ${auth.organization.id} and status = 'active') as active_members,
        (
          select count(*)::int
          from organization_invites
          where org_id = ${auth.organization.id}
            and status = 'pending'
            and expires_at > now()
            and email <> ${email}
        ) as pending_invites
    `;
    const plan = String(limits?.plan ?? "solo");
    const seats = Number(limits?.seats ?? 1);
    const activeMembers = Number(limits?.active_members ?? 0);
    const pendingInvites = Number(limits?.pending_invites ?? 0);
    const totalAfterInvite = activeMembers + pendingInvites + 1;
    if (plan === "solo" && totalAfterInvite > 1) {
      return Response.json(
        {
          error: "plan_limit",
          message: "Solo includes one active member. Upgrade to Team before inviting additional members.",
          plan,
          seats,
        },
        { status: 403 },
      );
    }
    if (plan === "team" && totalAfterInvite > seats) {
      return Response.json(
        {
          error: "seat_limit",
          message: "This Team plan does not have enough seats for another invite.",
          plan,
          seats,
          used_seats: activeMembers + pendingInvites,
        },
        { status: 403 },
      );
    }

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
