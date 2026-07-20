import { claimAgentRunsForRuntime, completeAgentRunFromRuntime } from "@/lib/core/agent-runtime";
import { executeAgentPacket } from "@/lib/core/agent-executor";
import { cronDisabledResponse, cronsEnabled, isCronAuthorized } from "@/lib/cron-guard";
import { recordCronRun } from "@/lib/core/cron-run";
import { hostedExecutionDisabledResponse, hostedExecutionEnabled } from "@/lib/core/hosted-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WORKER_ID = "vercel-cron";
// Stop claiming new work before maxDuration so an in-flight run has room to finish.
const TICK_BUDGET_MS = 260000;
const CLAIM_LIMIT = 3;
const LEASE_SECONDS = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!cronsEnabled()) {
    return cronDisabledResponse();
  }

  if (!hostedExecutionEnabled()) {
    return hostedExecutionDisabledResponse();
  }

  try {
    const result = await recordCronRun("agent-worker", async () => {
      const start = Date.now();
      let claimed = 0;
      let completed = 0;
      let failed = 0;

      while (Date.now() - start < TICK_BUDGET_MS) {
        const packets = await claimAgentRunsForRuntime({
          workerId: WORKER_ID,
          limit: CLAIM_LIMIT,
          leaseSeconds: LEASE_SECONDS,
        });
        if (packets.length === 0) break;
        claimed += packets.length;

        for (const packet of packets) {
          try {
            const outcome = await executeAgentPacket(packet);
            await completeAgentRunFromRuntime({
              runId: packet.run.id,
              workerId: WORKER_ID,
              status: "succeeded",
              resultMd: outcome.result_md,
              usage: outcome.usage,
            });
            completed += 1;
          } catch (err) {
            failed += 1;
            // Best-effort failure mark: don't let a completion error (e.g. the lease
            // was reclaimed mid-run) abort the whole tick.
            try {
              await completeAgentRunFromRuntime({
                runId: packet.run.id,
                workerId: WORKER_ID,
                status: "failed",
                error: (err as Error)?.message ?? "agent_execution_failed",
              });
            } catch (completeErr) {
              console.error("agent-worker failed to mark run failed", {
                runId: packet.run.id,
                message: (completeErr as Error)?.message,
              });
            }
          }
        }
      }

      return { ok: true, claimed, completed, failed };
    });

    return Response.json(result, { status: 200 });
  } catch (err: unknown) {
    console.error("agent-worker cron failed", { message: (err as Error)?.message });
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
