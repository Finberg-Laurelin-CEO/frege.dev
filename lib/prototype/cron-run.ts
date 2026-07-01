// Structured logging wrapper for cron ticks.
//
// Vercel crons are fire-and-forget HTTP calls; the only durable record of a tick is
// what lands in the function logs. recordCronRun brackets a tick with start/ok/failed
// log lines (including duration and the tick's own summary fields) so a run can be
// traced without a bespoke telemetry table, and rethrows on failure so the caller can
// still translate the error into an HTTP status.

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function recordCronRun<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  console.log(`[cron:${job}] start`);
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    console.log(`[cron:${job}] ok`, { durationMs, ...(isRecord(result) ? result : { result }) });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    console.error(`[cron:${job}] failed`, { durationMs, message: (err as Error)?.message ?? String(err) });
    throw err;
  }
}
