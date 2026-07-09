// Records each cron tick into cron_runs (db/020_cron_runs.sql) and alerts via the
// existing Hermes webhook on failure, so a repeatedly-failing job is never silent.
// Wrap every cron route body in recordCronRun("<job>", async () => { ... }).

import { getSql } from "@/lib/db";
import { postHermesEvent } from "@/lib/hermes-webhook";

function extractDetail(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && "detail" in result) {
    const detail = (result as { detail?: unknown }).detail;
    if (detail && typeof detail === "object") return detail as Record<string, unknown>;
  }
  return {};
}

export async function recordCronRun<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const sql = getSql();
  const startedAt = Date.now();

  const inserted = (await sql`
    insert into cron_runs (job, status) values (${job}, 'running')
    returning id
  `.catch(() => [])) as { id: string }[];
  const runId = inserted[0]?.id ?? null;

  try {
    const result = await fn();
    if (runId) {
      await sql`
        update cron_runs
        set status = 'ok', ok = true, finished_at = now(),
            duration_ms = ${Date.now() - startedAt},
            detail = ${JSON.stringify(extractDetail(result))}::jsonb
        where id = ${runId}
      `.catch(() => {});
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await sql`
        update cron_runs
        set status = 'failed', ok = false, finished_at = now(),
            duration_ms = ${Date.now() - startedAt}, error = ${message}
        where id = ${runId}
      `.catch(() => {});
    }
    // Best-effort alert; never let alerting failure mask the original error.
    await postHermesEvent({
      event: "frege.cron.failed",
      job,
      error: message,
      at: new Date().toISOString(),
    }).catch(() => {});
    throw err;
  }
}
