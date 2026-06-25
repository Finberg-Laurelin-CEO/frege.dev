import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { sendInviteEmail } from "@/lib/prototype/email";
import { ensureDefaultAgentRoles, normalizeEmail, slugifyOrg } from "@/lib/prototype/org-guard";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { customerBaseUrl } from "@/lib/prototype/public-url";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const approveSchema = z.object({
  org_name: z.string().trim().min(1).max(160).optional(),
  org_slug: z.string().trim().min(1).max(80).optional(),
});

function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

async function uniqueOrgSlug(sql: ReturnType<typeof getSql>, base: string): Promise<string> {
  const root = slugifyOrg(base);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [existing] = await sql`select 1 from organizations where slug = ${candidate} limit 1`;
    if (!existing) return candidate;
  }
  return `${root}-${randomBytes(3).toString("hex")}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = approveSchema.safeParse(json.value ?? {});
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const { id } = await params;
    const sql = getSql();

    const [signup] = await sql`
      select id, name, work_email, company, status, invite_id
      from signups
      where id = ${id}
      limit 1
    `;
    if (!signup) return Response.json({ error: "not_found" }, { status: 404 });
    if (signup.invite_id) {
      return Response.json({ error: "already_invited" }, { status: 409 });
    }

    const orgName = parsed.data.org_name ?? signup.company ?? signup.name ?? signup.work_email;
    const slug = parsed.data.org_slug
      ? await uniqueOrgSlug(sql, parsed.data.org_slug)
      : await uniqueOrgSlug(sql, orgName);

    // Create the org as inactive (pay-to-activate), default roles, and an owner invite.
    const [org] = await sql`
      insert into organizations (slug, name, status)
      values (${slug}, ${orgName}, 'inactive')
      returning id, slug, name, status
    `;
    await ensureDefaultAgentRoles(org.id);

    const rawToken = randomBytes(24).toString("base64url");
    const [invite] = await sql`
      insert into organization_invites (
        org_id, email, role, invited_by_user_id, invite_token_hash, expires_at
      ) values (
        ${org.id},
        ${normalizeEmail(signup.work_email)},
        'owner',
        ${staff.auth.user.id},
        ${hashInviteToken(rawToken)},
        ${new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()}
      )
      returning id, email, role, status, expires_at
    `;

    await sql`
      update signups
      set
        status = 'qualified',
        qualified_at = coalesce(qualified_at, now()),
        owner_user_id = ${staff.auth.user.id},
        invited_at = now(),
        invite_id = ${invite.id}
      where id = ${signup.id}
    `;

    // Build the invite link against the customer-facing site (never the admin
    // origin this request arrives on) and email it to the prospect.
    const inviteLink = `${customerBaseUrl()}/invite?token=${rawToken}`;
    const emailResult = await sendInviteEmail({
      to: invite.email,
      inviteUrl: inviteLink,
      orgName: org.name,
    });

    await logTelemetryEvent({
      actor: { type: "system", orgId: org.id },
      req,
      action: "platform.signups.approve",
      resourceType: "organization_invite",
      resourceId: invite.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: {
        signup_id: signup.id,
        org_slug: org.slug,
        by_user: staff.auth.user.email,
        email_sent: emailResult.sent,
      },
    });

    return Response.json(
      {
        organization: org,
        invite,
        email_sent: emailResult.sent,
        // Kept as a staff fallback (e.g. email not configured / bounced) so the
        // operator can hand off the link manually if needed.
        invite_token: rawToken,
        invite_link: inviteLink,
      },
      { status: 201 },
    );
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") return Response.json({ error: "conflict" }, { status: 409 });
    return routeError("platform signup approve failed", err);
  }
}
