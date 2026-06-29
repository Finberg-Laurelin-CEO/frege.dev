import { Resend } from "resend";
import { customerBaseUrl } from "@/lib/prototype/public-url";

// Transactional email via Resend. Env-gated like the Stripe/Auth0 clients: when
// RESEND_API_KEY is unset (dev/preview without email configured), sends become a
// logged no-op instead of throwing, so onboarding still works end-to-end locally.

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// Send from the verified updates.frege.dev subdomain (DKIM/SPF configured in
// Resend). Replies are routed to the real hello@frege.dev mailbox via Reply-To.
function fromAddress(): string {
  return process.env.FREGE_EMAIL_FROM?.trim() || "Frege <hello@updates.frege.dev>";
}

function replyToAddress(): string {
  return process.env.FREGE_EMAIL_REPLY_TO?.trim() || "hello@frege.dev";
}

let cachedClient: Resend | null = null;

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("email_not_configured");
  cachedClient ??= new Resend(key);
  return cachedClient;
}

export type SendResult = { sent: boolean; id?: string; reason?: string };

type InviteEmailInput = {
  to: string;
  inviteUrl: string;
  orgName: string;
};

type StripePromoCodeEmailInput = {
  to: string;
  code: string;
  durationMonths: 1 | 12;
  label?: string | null;
};

type InviteWithStripePromoCodeEmailInput = {
  to: string;
  inviteUrl: string;
  orgName: string;
  code: string;
  durationMonths: 1 | 12;
};

function inviteSubject(orgName: string): string {
  return `You're approved for Frege — set up ${orgName}`;
}

function inviteTextBody(input: InviteEmailInput): string {
  return [
    `You've been approved to set up ${input.orgName} on Frege.`,
    "",
    "Get started in three steps:",
    "",
    "1. Create your account (set a password):",
    `   ${input.inviteUrl}`,
    "",
    "2. Activate your organization by completing payment.",
    "",
    "3. Create an API key so your agents can connect to your brain over MCP.",
    "",
    "This invite link expires in 14 days. If it expires, reply and we'll send a fresh one.",
    "",
    "— The Frege team",
  ].join("\n");
}

function inviteHtmlBody(input: InviteEmailInput): string {
  const safeOrg = escapeHtml(input.orgName);
  const safeUrl = escapeHtml(input.inviteUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
      <tr><td>
        <h1 style="font-size:20px;margin:0 0 16px;">You're approved for Frege</h1>
        <p style="font-size:15px;line-height:1.5;margin:0 0 20px;">
          You've been approved to set up <strong>${safeOrg}</strong>. Get started in three steps:
        </p>
        <ol style="font-size:15px;line-height:1.6;margin:0 0 24px;padding-left:20px;">
          <li>Create your account (set a password).</li>
          <li>Activate your organization by completing payment.</li>
          <li>Create an API key so your agents can connect over MCP.</li>
        </ol>
        <p style="margin:0 0 28px;">
          <a href="${safeUrl}" style="display:inline-block;background:#0033cc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
            Create your account
          </a>
        </p>
        <p style="font-size:13px;color:#666;line-height:1.5;margin:0;">
          This invite link expires in 14 days. If the button doesn't work, paste this URL into your browser:<br>
          <span style="word-break:break-all;color:#0033cc;">${safeUrl}</span>
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function stripePromoDurationLabel(months: 1 | 12): string {
  return months === 12 ? "1 year free" : "1 month free";
}

function stripePromoCheckoutUrl(): string {
  return `${customerBaseUrl()}/console?view=billing`;
}

function stripePromoSubject(input: StripePromoCodeEmailInput): string {
  return `Your Frege ${stripePromoDurationLabel(input.durationMonths)} code`;
}

function stripePromoTextBody(input: StripePromoCodeEmailInput): string {
  const label = stripePromoDurationLabel(input.durationMonths);
  return [
    `Here is your Frege ${label} Stripe promotion code:`,
    "",
    `   ${input.code}`,
    "",
    "Use it during Stripe Checkout when you set up billing:",
    `   ${stripePromoCheckoutUrl()}`,
    "",
    "Choose a plan, continue to payment, and enter the code in Stripe's promotion code field.",
    "",
    "— The Frege team",
  ].join("\n");
}

function stripePromoHtmlBody(input: StripePromoCodeEmailInput): string {
  const safeCode = escapeHtml(input.code);
  const safeLabel = escapeHtml(stripePromoDurationLabel(input.durationMonths));
  const safeUrl = escapeHtml(stripePromoCheckoutUrl());
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
      <tr><td>
        <h1 style="font-size:20px;margin:0 0 16px;">Your Frege ${safeLabel} code</h1>
        <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">
          Use this Stripe promotion code when you set up billing:
        </p>
        <p style="margin:0 0 24px;">
          <span style="display:inline-block;border:1px solid #d8dedb;background:#f6f8f7;border-radius:8px;padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;letter-spacing:0;">
            ${safeCode}
          </span>
        </p>
        <p style="margin:0 0 28px;">
          <a href="${safeUrl}" style="display:inline-block;background:#0033cc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
            Set up billing
          </a>
        </p>
        <p style="font-size:13px;color:#666;line-height:1.5;margin:0;">
          Choose a plan, continue to payment, and enter the code in Stripe's promotion code field.
          If the button doesn't work, paste this URL into your browser:<br>
          <span style="word-break:break-all;color:#0033cc;">${safeUrl}</span>
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function inviteWithStripePromoSubject(input: InviteWithStripePromoCodeEmailInput): string {
  return `You're approved for Frege — ${stripePromoDurationLabel(input.durationMonths)} included`;
}

function inviteWithStripePromoTextBody(input: InviteWithStripePromoCodeEmailInput): string {
  return [
    `You've been approved to set up ${input.orgName} on Frege.`,
    "",
    `Your Stripe promotion code is ${input.code} for ${stripePromoDurationLabel(input.durationMonths)}.`,
    "",
    "Get started:",
    "",
    "1. Create your Frege account:",
    `   ${input.inviteUrl}`,
    "",
    "2. Choose a plan and continue to Stripe Checkout.",
    "",
    "3. Enter this promotion code in Stripe:",
    `   ${input.code}`,
    "",
    "This invite link expires in 14 days. If it expires, reply and we'll send a fresh one.",
    "",
    "— The Frege team",
  ].join("\n");
}

function inviteWithStripePromoHtmlBody(input: InviteWithStripePromoCodeEmailInput): string {
  const safeOrg = escapeHtml(input.orgName);
  const safeUrl = escapeHtml(input.inviteUrl);
  const safeCode = escapeHtml(input.code);
  const safeLabel = escapeHtml(stripePromoDurationLabel(input.durationMonths));
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
      <tr><td>
        <h1 style="font-size:20px;margin:0 0 16px;">You're approved for Frege</h1>
        <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">
          You've been approved to set up <strong>${safeOrg}</strong>. Your ${safeLabel} Stripe promotion code is:
        </p>
        <p style="margin:0 0 22px;">
          <span style="display:inline-block;border:1px solid #d8dedb;background:#f6f8f7;border-radius:8px;padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;letter-spacing:0;">
            ${safeCode}
          </span>
        </p>
        <ol style="font-size:15px;line-height:1.6;margin:0 0 24px;padding-left:20px;">
          <li>Create your Frege account.</li>
          <li>Choose a plan and continue to Stripe Checkout.</li>
          <li>Enter the promotion code in Stripe.</li>
        </ol>
        <p style="margin:0 0 28px;">
          <a href="${safeUrl}" style="display:inline-block;background:#0033cc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
            Create your account
          </a>
        </p>
        <p style="font-size:13px;color:#666;line-height:1.5;margin:0;">
          This invite link expires in 14 days. If the button doesn't work, paste this URL into your browser:<br>
          <span style="word-break:break-all;color:#0033cc;">${safeUrl}</span>
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendInviteEmail(input: InviteEmailInput): Promise<SendResult> {
  if (!isEmailConfigured()) {
    console.warn("email not configured; invite email skipped", { to: input.to });
    return { sent: false, reason: "not_configured" };
  }

  const { data, error } = await getResend().emails.send({
    from: fromAddress(),
    to: input.to,
    replyTo: replyToAddress(),
    subject: inviteSubject(input.orgName),
    text: inviteTextBody(input),
    html: inviteHtmlBody(input),
  });

  if (error) {
    console.error("invite email send failed", { to: input.to, message: error.message });
    return { sent: false, reason: error.message };
  }
  return { sent: true, id: data?.id };
}

export async function sendStripePromoCodeEmail(input: StripePromoCodeEmailInput): Promise<SendResult> {
  if (!isEmailConfigured()) {
    console.warn("email not configured; Stripe promo code email skipped", { to: input.to });
    return { sent: false, reason: "not_configured" };
  }

  const { data, error } = await getResend().emails.send({
    from: fromAddress(),
    to: input.to,
    replyTo: replyToAddress(),
    subject: stripePromoSubject(input),
    text: stripePromoTextBody(input),
    html: stripePromoHtmlBody(input),
  });

  if (error) {
    console.error("Stripe promo code email send failed", { to: input.to, message: error.message });
    return { sent: false, reason: error.message };
  }
  return { sent: true, id: data?.id };
}

export async function sendInviteWithStripePromoCodeEmail(input: InviteWithStripePromoCodeEmailInput): Promise<SendResult> {
  if (!isEmailConfigured()) {
    console.warn("email not configured; invite + Stripe promo email skipped", { to: input.to });
    return { sent: false, reason: "not_configured" };
  }

  const { data, error } = await getResend().emails.send({
    from: fromAddress(),
    to: input.to,
    replyTo: replyToAddress(),
    subject: inviteWithStripePromoSubject(input),
    text: inviteWithStripePromoTextBody(input),
    html: inviteWithStripePromoHtmlBody(input),
  });

  if (error) {
    console.error("invite + Stripe promo email send failed", { to: input.to, message: error.message });
    return { sent: false, reason: error.message };
  }
  return { sent: true, id: data?.id };
}
