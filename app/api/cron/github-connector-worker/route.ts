import { cronDisabledResponse, cronsEnabled, isCronAuthorized } from "@/lib/cron-guard";
import { recordCronRun } from "@/lib/core/cron-run";
import {
  claimPendingGitHubPushWebhooks,
  listRecoverableGitHubInitialSyncs,
  processClaimedGitHubWebhook,
} from "@/lib/core/github-webhook";
import { syncGitHubConnectorWithManagedAuthority } from "@/lib/core/github-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Keep each tick deliberately small. A repository sync can consume most of a
// serverless invocation and any unclaimed work remains durable in Postgres.
const CLAIM_LIMIT = 2;
const INITIAL_SYNC_LIMIT = 1;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!cronsEnabled()) {
    return cronDisabledResponse();
  }

  try {
    const result = await recordCronRun("github-connector-worker", async () => {
      const initialSyncs = await listRecoverableGitHubInitialSyncs({ limit: INITIAL_SYNC_LIMIT });
      let initialRecovered = 0;
      let initialDeferred = 0;
      let initialFailed = 0;
      for (const pending of initialSyncs) {
        try {
          const result = await syncGitHubConnectorWithManagedAuthority({
            connectorId: pending.connectorId,
            triggerKind: "initial",
            idempotencyKey: pending.idempotencyKey,
            requestId: `github-initial-worker:${pending.connectorId}:${pending.generation}`,
          });
          if (
            result.authorization_receipt.decision === "allow" &&
            result.sync_run &&
            ["succeeded", "noop"].includes(result.sync_run.status)
          ) {
            initialRecovered += 1;
          } else {
            initialDeferred += 1;
          }
        } catch (error) {
          initialFailed += 1;
          console.error("github connector worker initial sync failed", {
            connector_id: pending.connectorId,
            generation: pending.generation,
            error_code: (error as { code?: string })?.code ?? "github_initial_sync_failed",
          });
        }
      }

      // Claim pushes only after initial recovery so their ten-minute delivery
      // leases are not burning while a potentially large initial sync runs.
      const claims = await claimPendingGitHubPushWebhooks({ limit: CLAIM_LIMIT });
      let processed = 0;
      let ignored = 0;
      let failed = 0;

      for (const claim of claims) {
        try {
          const outcome = await processClaimedGitHubWebhook(claim);
          if (outcome === "processed") processed += 1;
          else if (outcome === "ignored") ignored += 1;
          else if (outcome === "failed") failed += 1;
        } catch (error) {
          // processClaimedGitHubWebhook attempt-fences its failure update. If
          // even that database write fails, the lease expires and a later tick
          // reclaims the same payload-free delivery ledger row.
          failed += 1;
          console.error("github connector worker delivery failed", {
            delivery_id: claim.deliveryId,
            attempt_count: claim.attemptCount,
            error_code: (error as { code?: string })?.code ?? "github_webhook_failed",
          });
        }
      }

      const detail = {
        claimed: claims.length,
        processed,
        ignored,
        failed,
        initial_claimed: initialSyncs.length,
        initial_recovered: initialRecovered,
        initial_deferred: initialDeferred,
        initial_failed: initialFailed,
      };
      return {
        detail,
        response: Response.json({ ok: true, ...detail }, { status: 200 }),
      };
    });
    return result.response;
  } catch (error) {
    console.error("github connector worker cron failed", {
      message: (error as Error)?.message,
    });
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
