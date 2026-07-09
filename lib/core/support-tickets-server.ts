import { getSql } from "@/lib/db";
import { sendSupportTicketCreatedEmail, sendSupportTicketReplyEmail } from "@/lib/core/email";
import { recordPlatformAudit } from "@/lib/core/platform-audit";
import type { PlatformStaffContext } from "@/lib/core/platform-auth";
import { routeError } from "@/lib/core/request-guards";
import {
  type StaffSupportTicketDeps,
  type SupportTicketDeps,
  type SupportTicketNotifications,
  type SupportTicketsSql,
} from "@/lib/core/support-tickets";
import { logTelemetryEvent } from "@/lib/core/telemetry";

// Real dependency wiring for the support-ticket route cores. Kept out of
// lib/core/support-tickets.ts so the cores stay importable in unit tests
// without pulling in the Neon driver, Resend, or telemetry.

// New-ticket notifications go to this address. Unset (the default) means
// ticket creation silently skips the staff email — same env-gated no-op
// contract as the rest of lib/core/email.ts.
function staffNotifyEmail(): string | null {
  const configured = process.env.FREGE_SUPPORT_NOTIFY_EMAIL?.trim();
  return configured || null;
}

const notifications: SupportTicketNotifications = {
  staffNotifyEmail,
  sendTicketCreatedEmail: sendSupportTicketCreatedEmail,
  sendStaffReplyEmail: sendSupportTicketReplyEmail,
};

export function customerSupportTicketDeps(): SupportTicketDeps {
  return {
    getSql: () => getSql() as unknown as SupportTicketsSql,
    logTelemetryEvent,
    routeError,
    notifications,
  };
}

export function staffSupportTicketDeps(staff: PlatformStaffContext): StaffSupportTicketDeps {
  return {
    ...customerSupportTicketDeps(),
    recordPlatformAudit: (input) => recordPlatformAudit(staff, input),
  };
}
