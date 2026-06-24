import { createHash } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { hashPassword } from "@/lib/prototype/password";
import { checkRateLimit, rateLimitedResponse } from "@/lib/prototype/rate-limit";
import { assertSafeOrigin, readJson, routeError } from "@/lib/prototype/request-guards";
import { createUserSession } from "@/lib/prototype/session";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const acceptInviteSchema = z.object({
  token: z.string().min(16).max(256),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(256),
});

type InviteRow = {
  id: string;
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: "inactive" | "active" | "suspended";
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
};

type UserRow = {
  id: string;
  email: string;
  name: string;
};

function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = acceptInviteSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const tokenHash = hashInviteToken(parsed.data.token);
    const limit = await checkRateLimit(req, {
      action: "auth.invite.accept",
      limit: 10,
      windowSeconds: 10 * 60,
      keyParts: [tokenHash],
    });
    if (!limit.allowed) return rateLimitedResponse(limit);

    const sql = getSql();
    const rows = await sql`
      select
        organization_invites.id,
        organization_invites.org_id,
        organizations.slug as org_slug,
        organizations.name as org_name,
        organizations.status as org_status,
        organization_invites.email,
        organization_invites.role
      from organization_invites
      join organizations on organizations.id = organization_invites.org_id
      where invite_token_hash = ${tokenHash}
        and organization_invites.status = 'pending'
        and organization_invites.expires_at > now()
      limit 1
    `;
    const invite = rows[0] as InviteRow | undefined;
    if (!invite) return Response.json({ error: "invalid_invite" }, { status: 404 });

    let user = (await sql`
      select id, email, name
      from users
      where email = ${invite.email}
      limit 1
    `)[0] as UserRow | undefined;

    if (!user) {
      [user] = await sql`
        insert into users (email, name, status)
        values (${invite.email}, ${parsed.data.name.trim()}, 'active')
        returning id, email, name
      ` as UserRow[];
    } else {
      [user] = await sql`
        update users
        set name = case when trim(name) = '' then ${parsed.data.name.trim()} else name end,
            status = 'active'
        where id = ${user.id}
        returning id, email, name
      ` as UserRow[];
    }

    const credentialRows = await sql`
      select user_id
      from user_password_credentials
      where user_id = ${user.id}
      limit 1
    `;
    if (credentialRows.length === 0) {
      const password = await hashPassword(parsed.data.password);
      await sql`
        insert into user_password_credentials (user_id, password_hash, password_salt, password_params)
        values (${user.id}, ${password.passwordHash}, ${password.passwordSalt}, ${JSON.stringify(password.passwordParams)}::jsonb)
      `;
    }

    await sql`
      insert into organization_memberships (org_id, user_id, role, status)
      values (${invite.org_id}, ${user.id}, ${invite.role}, 'active')
      on conflict (org_id, user_id) do update
        set role = excluded.role,
            status = 'active'
    `;
    await sql`
      update organization_invites
      set status = 'accepted', accepted_at = now()
      where id = ${invite.id}
    `;

    const session = await createUserSession(user.id);
    const canManageBilling = invite.role === "owner" || invite.role === "admin";
    const nextPath = invite.org_status === "active" || !canManageBilling ? "/admin" : "/billing";
    await logTelemetryEvent({
      actor: { type: "system", orgId: invite.org_id },
      req,
      action: "auth.invite.accept",
      resourceType: "organization_invite",
      resourceId: invite.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { email: invite.email, role: invite.role },
    });

    return Response.json(
      {
        user: { id: user.id, email: user.email, name: user.name },
        organization: {
          id: invite.org_id,
          slug: invite.org_slug,
          name: invite.org_name,
          status: invite.org_status,
        },
        next_path: nextPath,
      },
      { status: 200, headers: { "Set-Cookie": session.cookie } },
    );
  } catch (err) {
    return routeError("invite accept failed", err);
  }
}
