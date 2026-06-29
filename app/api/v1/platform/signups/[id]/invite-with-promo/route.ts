import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { sendInviteWithStripePromoCodeEmail, sendStripePromoCodeEmail } from "@/lib/prototype/email";
import { generateInviteToken, hashInviteToken, inviteLinkForToken } from "@/lib/prototype/invites";
import { ensureDefaultAgentRoles, normalizeEmail, slugifyOrg } from "@/lib/prototype/org-guard";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { recordPlatformAudit } from "@/lib/prototype/platform-audit";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const inviteWithPromoSchema = z.object({
  duration_months: z.union([z.literal(1), z.literal(12)]),
  org_name: z.string().trim().min(1).max(160).optional(),
  org_slug: z.string().trim().min(1).max(80).optional(),
});

function durationLabel(months: 1 | 12): string {
  return months === 12 ? "1 year free" : "1 month free";
}

function promoPrefix(months: 1 | 12): string {
  return months === 12 ? "FREGE-1YR" : "FREGE-1MO";
}

function generatePromoCode(months: 1 | 12): string {
  return `${promoPrefix(months)}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function couponName(input: { company?: string | null; email: string; months: 1 | 12 }): string {
  const owner = input.company || input.email;
  return `Frege ${durationLabel(input.months)} - ${owner}`;
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

function stripePermissionResponse(err: unknown): Response | null {
  const code = (err as { code?: string })?.code;
  if (code !== "api_key_insufficient_permissions") return null;
  return Response.json(
    {
      error: "insufficient_stripe_permission",
      message: "Stripe key lacks permission to create coupons or promotion codes.",
    },
    { status: 502 },
  );
}

type SetupTarget = {
  mode: "approved" | "reissued" | "promo_only";
  signupId: string;
  email: string;
  org: { id: string; slug: string; name: string; status: string };
  invite: { id: string; status: string } | null;
  inviteLink: string | null;
};

async function ensureSetupTarget(
  sql: ReturnType<typeof getSql>,
  staffUserId: string,
  parsed: z.infer<typeof inviteWithPromoSchema>,
  signupId: string,
): Promise<SetupTarget | { error: Response }> {
  const [signup] = await sql`
    select
      s.id,
      s.name,
      s.work_email,
      s.company,
      s.invite_id,
      i.id as existing_invite_id,
      i.email as invite_email,
      i.status as invite_status,
      o.id as org_id,
      o.slug as org_slug,
      o.name as org_name,
      o.status as org_status
    from signups s
    left join organization_invites i on i.id = s.invite_id
    left join organizations o on o.id = i.org_id
    where s.id = ${signupId}
    limit 1
  `;
  if (!signup) return { error: Response.json({ error: "not_found" }, { status: 404 }) };

  const email = normalizeEmail(String(signup.invite_email ?? signup.work_email));

  if (signup.existing_invite_id) {
    const org = {
      id: String(signup.org_id),
      slug: String(signup.org_slug),
      name: String(signup.org_name),
      status: String(signup.org_status),
    };
    if (org.status === "active") {
      return { error: Response.json({ error: "org_already_active" }, { status: 409 }) };
    }

    if (signup.invite_status === "accepted") {
      return {
        mode: "promo_only",
        signupId: String(signup.id),
        email,
        org,
        invite: { id: String(signup.existing_invite_id), status: "accepted" },
        inviteLink: null,
      };
    }

    const rawToken = generateInviteToken();
    await sql`
      update organization_invites
      set
        invite_token_hash = ${hashInviteToken(rawToken)},
        status = 'pending',
        expires_at = ${new Date(Date.now() + INVITE_TTL_MS).toISOString()}
      where id = ${signup.existing_invite_id}
    `;
    await sql`
      update signups
      set invited_at = now()
      where id = ${signup.id}
    `;

    return {
      mode: "reissued",
      signupId: String(signup.id),
      email,
      org,
      invite: { id: String(signup.existing_invite_id), status: "pending" },
      inviteLink: inviteLinkForToken(rawToken),
    };
  }

  const orgName = parsed.org_name ?? signup.company ?? signup.name ?? signup.work_email;
  const slug = parsed.org_slug ? await uniqueOrgSlug(sql, parsed.org_slug) : await uniqueOrgSlug(sql, orgName);
  const [org] = await sql`
    insert into organizations (slug, name, status)
    values (${slug}, ${orgName}, 'inactive')
    returning id, slug, name, status
  `;
  await ensureDefaultAgentRoles(org.id);

  const rawToken = generateInviteToken();
  const [invite] = await sql`
    insert into organization_invites (
      org_id, email, role, invited_by_user_id, invite_token_hash, expires_at
    ) values (
      ${org.id},
      ${email},
      'owner',
      ${staffUserId},
      ${hashInviteToken(rawToken)},
      ${new Date(Date.now() + INVITE_TTL_MS).toISOString()}
    )
    returning id, status
  `;

  await sql`
    update signups
    set
      status = 'qualified',
      qualified_at = coalesce(qualified_at, now()),
      owner_user_id = ${staffUserId},
      invited_at = now(),
      invite_id = ${invite.id}
    where id = ${signup.id}
  `;

  return {
    mode: "approved",
    signupId: String(signup.id),
    email,
    org: {
      id: String(org.id),
      slug: String(org.slug),
      name: String(org.name),
      status: String(org.status),
    },
    invite: { id: String(invite.id), status: String(invite.status) },
    inviteLink: inviteLinkForToken(rawToken),
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    if (!isStripeConfigured()) {
      return Response.json({ error: "billing_unavailable" }, { status: 503 });
    }

    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = inviteWithPromoSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const { id } = await params;
    const sql = getSql();
    const target = await ensureSetupTarget(sql, staff.auth.user.id, parsed.data, id);
    if ("error" in target) return target.error;

    const stripe = getStripe();
    const metadata = {
      source: "frege_signup_invite",
      signup_id: target.signupId,
      org_id: target.org.id,
      org_slug: target.org.slug,
      recipient_email: target.email,
      duration_months: String(parsed.data.duration_months),
      created_by_email: staff.auth.user.email,
    };
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: "repeating",
      duration_in_months: parsed.data.duration_months,
      max_redemptions: 1,
      name: couponName({ company: target.org.name, email: target.email, months: parsed.data.duration_months }),
      metadata,
    });
    const promo = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code: generatePromoCode(parsed.data.duration_months),
      max_redemptions: 1,
      expires_at: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
      metadata,
    });

    const emailResult = target.inviteLink
      ? await sendInviteWithStripePromoCodeEmail({
          to: target.email,
          inviteUrl: target.inviteLink,
          orgName: target.org.name,
          code: promo.code,
          durationMonths: parsed.data.duration_months,
        })
      : await sendStripePromoCodeEmail({
          to: target.email,
          code: promo.code,
          durationMonths: parsed.data.duration_months,
          label: target.org.name,
        });

    const [row] = await sql`
      insert into stripe_promo_codes (
        label,
        recipient_email,
        duration_months,
        percent_off,
        max_redemptions,
        status,
        stripe_coupon_id,
        stripe_promotion_code_id,
        code,
        coupon_name,
        expires_at,
        times_redeemed,
        created_by_user_id,
        created_by_email,
        sent_to_email,
        sent_at,
        email_sent,
        email_error,
        metadata
      ) values (
        ${`${target.org.slug} signup ${durationLabel(parsed.data.duration_months)}`},
        ${target.email},
        ${parsed.data.duration_months},
        100,
        1,
        ${promo.active ? "active" : "inactive"},
        ${coupon.id},
        ${promo.id},
        ${promo.code},
        ${coupon.name ?? null},
        ${promo.expires_at ? new Date(promo.expires_at * 1000).toISOString() : null},
        ${promo.times_redeemed ?? 0},
        ${staff.auth.user.id},
        ${staff.auth.user.email},
        ${target.email},
        ${new Date().toISOString()},
        ${emailResult.sent},
        ${emailResult.reason ?? null},
        ${JSON.stringify({ ...metadata, stripe_livemode: promo.livemode })}::jsonb
      )
      returning
        id,
        label,
        recipient_email,
        duration_months,
        percent_off,
        max_redemptions,
        status,
        stripe_coupon_id,
        stripe_promotion_code_id,
        code,
        coupon_name,
        expires_at,
        times_redeemed,
        created_by_email,
        created_at,
        sent_to_email,
        sent_at,
        email_sent,
        email_error,
        metadata
    `;

    await Promise.all([
      recordPlatformAudit(staff.auth, {
        action: "signup.invite_with_stripe_promo",
        targetType: "signup",
        targetId: target.signupId,
        metadata: {
          org_id: target.org.id,
          org_slug: target.org.slug,
          invite_id: target.invite?.id ?? null,
          invite_mode: target.mode,
          stripe_promotion_code_id: promo.id,
          duration_months: parsed.data.duration_months,
          email_sent: emailResult.sent,
        },
      }),
      logTelemetryEvent({
        actor: { type: "system", orgId: target.org.id },
        req,
        action: "platform.signups.invite_with_stripe_promo",
        resourceType: "signup",
        resourceId: target.signupId,
        outcome: "success",
        latencyMs: Date.now() - startedAt,
        metadata: {
          by_user: staff.auth.user.email,
          invite_mode: target.mode,
          email_sent: emailResult.sent,
          duration_months: parsed.data.duration_months,
        },
      }),
    ]);

    return Response.json(
      {
        mode: target.mode,
        organization: target.org,
        invite: target.invite,
        invite_link: target.inviteLink,
        email_sent: emailResult.sent,
        email_reason: emailResult.reason ?? null,
        stripe_promo_code: row,
      },
      { status: 200 },
    );
  } catch (err) {
    const permissionError = stripePermissionResponse(err);
    if (permissionError) return permissionError;
    const code = (err as { code?: string })?.code;
    if (code === "23505") return Response.json({ error: "conflict" }, { status: 409 });
    return routeError("platform signup invite with Stripe promo failed", err);
  }
}
