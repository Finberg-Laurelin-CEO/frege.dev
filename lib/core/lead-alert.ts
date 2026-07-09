import { sendHotLeadAlertEmail } from "@/lib/core/email";
import type { LeadScore } from "@/lib/core/lead-score";

/* ───────────────────────────────────────────────────────────────────────────
   Hot-lead alerting: when a signup lands in the hot band, email the operator
   (docs/HERMES.md "notify Joe" guidance, now in-app). Gated by
   FREGE_LEAD_ALERT_EMAIL — unset means alerts are skipped. Failures are
   logged and swallowed so alerting can never block a signup.
   ─────────────────────────────────────────────────────────────────────────── */

export type HotLeadSignupSummary = {
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  expected_users: number;
  current_agent_tools: string[];
  monthly_ai_spend: string;
  willing_to_pay: string;
  decision_timeline: string;
  main_pain_point: string;
};

export type HotLeadAlertDeps = {
  /** Injectable for tests; defaults to the Resend sender in lib/core/email.ts. */
  sendEmail?: typeof sendHotLeadAlertEmail;
  /** Injectable for tests; defaults to FREGE_LEAD_ALERT_EMAIL. */
  alertEmail?: string | null;
};

export function leadAlertEmail(): string | null {
  const value = process.env.FREGE_LEAD_ALERT_EMAIL?.trim();
  return value ? value : null;
}

export async function maybeSendHotLeadAlert(
  lead: LeadScore,
  signup: HotLeadSignupSummary,
  deps: HotLeadAlertDeps = {},
): Promise<{ sent: boolean; reason?: string }> {
  if (lead.band !== "hot") return { sent: false, reason: "not_hot" };

  const to = deps.alertEmail !== undefined ? deps.alertEmail : leadAlertEmail();
  if (!to) return { sent: false, reason: "alert_email_unset" };

  const sendEmail = deps.sendEmail ?? sendHotLeadAlertEmail;
  try {
    const result = await sendEmail({
      to,
      signup,
      score: lead.score,
      highSignals: lead.highSignals,
    });
    return { sent: result.sent, reason: result.reason };
  } catch (err: unknown) {
    console.error("hot lead alert email failed", { message: (err as Error)?.message });
    return { sent: false, reason: (err as Error)?.message ?? "send_failed" };
  }
}
