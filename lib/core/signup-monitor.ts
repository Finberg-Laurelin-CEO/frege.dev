import { getSql } from "@/lib/db";

/* ───────────────────────────────────────────────────────────────────────────
   Frege-native signup monitoring (stopgap replacing the external Hermes
   consumer). Every signal we would have POSTed to Hermes is persisted to the
   signup_monitor_events table (db/026) instead; the external webhook only
   fires when FREGE_EXTERNAL_MONITOR_ENABLED=true (see lib/hermes-webhook.ts).

   Inserts are best-effort: failures are logged and swallowed so monitoring
   can never block a signup or a cron run.
   ─────────────────────────────────────────────────────────────────────────── */

export type SignupMonitorEventType = "frege.signup.created" | "frege.signup.stats.snapshot";

type SqlLike = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export type SignupMonitorDeps = {
  /** Injectable for tests; defaults to the shared Neon client. */
  sql?: SqlLike;
};

export async function recordSignupMonitorEvent(
  eventType: SignupMonitorEventType,
  payload: unknown,
  deps: SignupMonitorDeps = {},
): Promise<{ recorded: boolean; reason?: string }> {
  try {
    const sql = deps.sql ?? (getSql() as unknown as SqlLike);
    await sql`
      insert into signup_monitor_events (event_type, payload)
      values (${eventType}, ${JSON.stringify(payload)}::jsonb)
    `;
    return { recorded: true };
  } catch (err: unknown) {
    // Never block the caller on monitor persistence.
    console.error("signup monitor event insert failed", {
      event_type: eventType,
      message: (err as Error)?.message,
    });
    return { recorded: false, reason: (err as Error)?.message ?? "insert_failed" };
  }
}
