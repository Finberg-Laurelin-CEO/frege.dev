import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { sendStripePromoCodeEmail } from "@/lib/prototype/email";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { recordPlatformAudit } from "@/lib/prototype/platform-audit";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  label: z.string().trim().max(160).optional(),
  recipient_email: z.string().trim().email().max(320).optional(),
  duration_months: z.union([z.literal(1), z.literal(12)]).default(1),
  send_email: z.boolean().default(true),
  expires_in_days: z.number().int().min(1).max(365).default(90),
  code: z.string().trim().min(4).max(64).regex(/^[A-Za-z0-9-]+$/).optional(),
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

function couponName(input: { label?: string; email?: string; months: 1 | 12 }): string {
  const suffix = input.label || input.email;
  return suffix ? `Frege ${durationLabel(input.months)} - ${suffix}` : `Frege ${durationLabel(input.months)}`;
}

function stripePromoSchemaResponse(label: string, err: unknown): Response | null {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? "");
  if (code !== "42P01" && !message.includes("stripe_promo_codes")) return null;

  console.error(label, {
    code,
    message: (err as { message?: string })?.message,
  });

  return Response.json(
    {
      error: "stripe_promo_codes_not_configured",
      message: "Stripe coupon storage is not configured for this deployment. Apply db/016_stripe_promo_codes.sql.",
    },
    { status: 503 },
  );
}

function stripePromoPermissionResponse(err: unknown): Response | null {
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

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const sql = getSql();
    const rows = await sql`
      select
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
      from stripe_promo_codes
      order by created_at desc
      limit 200
    `;

    return Response.json({ stripe_promo_codes: rows }, { status: 200 });
  } catch (err) {
    const permissionError = stripePromoPermissionResponse(err);
    if (permissionError) return permissionError;
    const schemaError = stripePromoSchemaResponse("platform Stripe promo code list schema missing", err);
    if (schemaError) return schemaError;
    return routeError("platform Stripe promo code list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    if (!isStripeConfigured()) {
      return Response.json({ error: "billing_unavailable" }, { status: 503 });
    }

    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = createSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "validation" }, { status: 400 });

    const recipientEmail = parsed.data.recipient_email?.toLowerCase();
    if (parsed.data.send_email && !recipientEmail) {
      return Response.json({ error: "recipient_required" }, { status: 400 });
    }
    const requestedCode = parsed.data.code?.toUpperCase();

    const stripe = getStripe();
    const name = couponName({
      label: parsed.data.label,
      email: recipientEmail,
      months: parsed.data.duration_months,
    });
    const expiresAt = Math.floor(Date.now() / 1000) + parsed.data.expires_in_days * 24 * 60 * 60;
    const metadata = {
      source: "frege_platform",
      duration_months: String(parsed.data.duration_months),
      recipient_email: recipientEmail ?? "",
      created_by_email: staff.auth.user.email,
    };

    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: "repeating",
      duration_in_months: parsed.data.duration_months,
      max_redemptions: 1,
      name,
      metadata,
    });

    const promo = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code: requestedCode || generatePromoCode(parsed.data.duration_months),
      max_redemptions: 1,
      expires_at: expiresAt,
      metadata,
    });

    const emailResult =
      parsed.data.send_email && recipientEmail
        ? await sendStripePromoCodeEmail({
            to: recipientEmail,
            code: promo.code,
            durationMonths: parsed.data.duration_months,
            label: parsed.data.label,
          })
        : { sent: false, reason: "not_requested" };

    const sql = getSql();
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
        ${parsed.data.label || null},
        ${recipientEmail ?? null},
        ${parsed.data.duration_months},
        100,
        1,
        ${promo.active ? "active" : "inactive"},
        ${coupon.id},
        ${promo.id},
        ${promo.code},
        ${coupon.name ?? name},
        ${promo.expires_at ? new Date(promo.expires_at * 1000).toISOString() : null},
        ${promo.times_redeemed ?? 0},
        ${staff.auth.user.id},
        ${staff.auth.user.email},
        ${recipientEmail ?? null},
        ${parsed.data.send_email && recipientEmail ? new Date().toISOString() : null},
        ${emailResult.sent},
        ${emailResult.reason ?? null},
        ${JSON.stringify({ stripe_livemode: promo.livemode })}::jsonb
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

    await recordPlatformAudit(staff.auth, {
      action: "stripe_promo_code.create",
      targetType: "stripe_promotion_code",
      targetId: promo.id,
      metadata: {
        code: promo.code,
        coupon_id: coupon.id,
        recipient_email: recipientEmail,
        duration_months: parsed.data.duration_months,
        email_sent: emailResult.sent,
      },
    });

    return Response.json({ stripe_promo_code: row, email_sent: emailResult.sent }, { status: 201 });
  } catch (err) {
    const permissionError = stripePromoPermissionResponse(err);
    if (permissionError) return permissionError;
    const schemaError = stripePromoSchemaResponse("platform Stripe promo code create schema missing", err);
    if (schemaError) return schemaError;
    return routeError("platform Stripe promo code create failed", err);
  }
}
