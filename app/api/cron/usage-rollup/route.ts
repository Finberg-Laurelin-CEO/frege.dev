import { getSql } from "@/lib/db";
import { rollupUsage } from "@/lib/core/usage";
import { cronDisabledResponse, cronsEnabled, isCronAuthorized } from "@/lib/cron-guard";
import { recordCronRun } from "@/lib/core/cron-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Best-effort housekeeping piggybacked on the hourly rollup: expired bookkeeping
// rows otherwise grow forever (nothing else deletes them). A cleanup failure is
// recorded in the cron_runs detail but never fails the rollup itself.
async function cleanupExpiredRows(): Promise<Record<string, unknown>> {
  const sql = getSql();
  try {
    const rateLimits = await sql`
      delete from auth_rate_limits
      where updated_at < now() - interval '2 days'
      returning 1
    `;
    const emailTokens = await sql`
      delete from email_verification_tokens
      where used_at is not null or expires_at < now()
      returning 1
    `;
    const resetTokens = await sql`
      delete from user_password_reset_tokens
      where used_at is not null or expires_at < now()
      returning 1
    `;
    const cronRuns = await sql`
      delete from cron_runs
      where started_at < now() - interval '30 days'
      returning 1
    `;
    return {
      cleanup: {
        auth_rate_limits: rateLimits.length,
        email_verification_tokens: emailTokens.length,
        user_password_reset_tokens: resetTokens.length,
        cron_runs: cronRuns.length,
      },
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error("usage rollup cleanup failed", { message });
    return { cleanup_error: message };
  }
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!cronsEnabled()) {
    return cronDisabledResponse();
  }

  try {
    const result = await recordCronRun("usage-rollup", async () => {
      const rollup = await rollupUsage(14);
      const cleanup = await cleanupExpiredRows();
      return {
        detail: { rolled_rows: rollup.rows, ...cleanup },
        response: Response.json({ ok: true, rolled_rows: rollup.rows, ...cleanup }, { status: 200 }),
      };
    });
    return result.response;
  } catch (err: unknown) {
    console.error("usage rollup cron failed", { message: (err as Error)?.message });
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
