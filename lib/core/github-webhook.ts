import { getSql } from "@/lib/db";
import {
  GitHubConnectorError,
  getGitHubConnectorById,
  revokeGitHubConnectorFromProvider,
  syncGitHubConnectorWithManagedAuthority,
  webhookPayloadDigest,
} from "@/lib/core/github-connector";

type Sql = ReturnType<typeof getSql>;

type GitHubWebhookPayload = {
  action?: string;
  ref?: string;
  installation?: { id?: number };
  repository?: { id?: number };
  repositories_added?: Array<{ id?: number }>;
  repositories_removed?: Array<{ id?: number }>;
};

export const MAX_GITHUB_PUSH_DELIVERY_ATTEMPTS = 5;
const GITHUB_WEBHOOK_LEASE_MINUTES = 10;
const MAX_GITHUB_PUSH_CLAIM_LIMIT = 10;
const MAX_GITHUB_INITIAL_SYNC_ATTEMPTS = 5;

export type ClaimedGitHubWebhook = {
  id: string;
  deliveryId: string;
  eventName: string;
  payloadDigest: string;
  payload: GitHubWebhookPayload;
  attemptCount: number;
  duplicate: boolean;
  ledgerStatus: "received" | "processing" | "ignored" | "processed" | "failed";
};

export type GitHubWebhookProcessOutcome = "processed" | "ignored" | "failed" | "duplicate";

export type RecoverableGitHubInitialSync = {
  connectorId: string;
  generation: number;
  idempotencyKey: string;
};

function safeExternalId(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

function webhookErrorCode(error: unknown): string {
  const raw = error instanceof GitHubConnectorError ? error.code : (error as Error)?.message ?? "github_webhook_failed";
  return raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 120) || "github_webhook_failed";
}

export async function claimGitHubWebhook(input: {
  deliveryId: string;
  eventName: string;
  rawBody: string;
  payload: unknown;
  sql?: Sql;
}): Promise<ClaimedGitHubWebhook> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(input.deliveryId)) {
    throw new GitHubConnectorError("github_delivery_id_invalid", 400);
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(input.eventName)) {
    throw new GitHubConnectorError("github_event_name_invalid", 400);
  }
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new GitHubConnectorError("github_webhook_payload_invalid", 400);
  }
  const sql = input.sql ?? getSql();
  const payload = input.payload as GitHubWebhookPayload;
  const digest = webhookPayloadDigest(input.rawBody);
  const installationId = safeExternalId(payload.installation?.id);
  const repositoryId = safeExternalId(payload.repository?.id);
  let existingId = "";
  let existingAttemptCount = 0;
  let existingStatus: ClaimedGitHubWebhook["ledgerStatus"] = "received";
  const [inserted] = await sql`
    insert into connector_webhook_deliveries (
      provider,
      delivery_id,
      event_name,
      event_action,
      payload_sha256,
      external_installation_id,
      external_resource_id,
      status
    ) values (
      'github',
      ${input.deliveryId},
      ${input.eventName},
      ${payload.action ?? null},
      ${digest},
      ${installationId},
      ${repositoryId},
      'received'
    )
    on conflict (provider, delivery_id) do nothing
    returning id
  `;

  if (!inserted) {
    const [existing] = await sql`
      select id, payload_sha256, status, lease_expires_at, attempt_count
      from connector_webhook_deliveries
      where provider = 'github' and delivery_id = ${input.deliveryId}
      limit 1
    `;
    if (!existing || existing.payload_sha256 !== digest) {
      throw new GitHubConnectorError("github_delivery_digest_collision", 409);
    }
    existingId = existing.id as string;
    existingAttemptCount = Number(existing.attempt_count ?? 0);
    existingStatus = existing.status as ClaimedGitHubWebhook["ledgerStatus"];
    if (["processed", "ignored"].includes(existing.status)) {
      return {
        id: existing.id as string,
        deliveryId: input.deliveryId,
        eventName: input.eventName,
        payloadDigest: digest,
        payload,
        attemptCount: existingAttemptCount,
        duplicate: true,
        ledgerStatus: existingStatus,
      };
    }
  }

  const [claimed] = await sql`
    update connector_webhook_deliveries
    set
      status = 'processing',
      attempt_count = attempt_count + 1,
      processing_started_at = now(),
      lease_expires_at = now() + interval '10 minutes',
      error_code = null
    where provider = 'github'
      and delivery_id = ${input.deliveryId}
      and payload_sha256 = ${digest}
      and (
        status in ('received', 'failed')
        or (status = 'processing' and lease_expires_at <= now())
      )
      and (${input.eventName} <> 'push' or attempt_count < ${MAX_GITHUB_PUSH_DELIVERY_ATTEMPTS})
    returning id, attempt_count
  `;
  if (!claimed) {
    return {
      id: (inserted?.id as string | undefined) ?? existingId,
      deliveryId: input.deliveryId,
      eventName: input.eventName,
      payloadDigest: digest,
      payload,
      attemptCount: existingAttemptCount,
      duplicate: true,
      ledgerStatus: existingStatus,
    };
  }
  return {
    id: claimed.id as string,
    deliveryId: input.deliveryId,
    eventName: input.eventName,
    payloadDigest: digest,
    payload,
    // `attempt_count` is always returned by Postgres. The fallback preserves
    // compatibility with narrow SQL test doubles while remaining monotonic.
    attemptCount: Number(claimed.attempt_count ?? existingAttemptCount + 1),
    duplicate: false,
    ledgerStatus: "processing",
  };
}

/**
 * Claims durable push work without needing the original webhook body. Only the
 * canonical numeric installation/repository identifiers accepted into the
 * delivery ledger are returned. Payloads and provider tokens are never stored.
 *
 * A delivery is held while its connector has an unexpired sync lease, or while
 * the same delivery's failed sync run has a future retry_after. This prevents a
 * minute cron from consuming all delivery attempts before the governed sync is
 * due to retry.
 */
export async function claimPendingGitHubPushWebhooks(input: {
  limit?: number;
  sql?: Sql;
} = {}): Promise<ClaimedGitHubWebhook[]> {
  const sql = input.sql ?? getSql();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 2), 1), MAX_GITHUB_PUSH_CLAIM_LIMIT);
  const rows = await sql`
    with candidates as (
      select deliveries.id
      from connector_webhook_deliveries deliveries
      where deliveries.provider = 'github'
        and deliveries.event_name = 'push'
        and deliveries.attempt_count < ${MAX_GITHUB_PUSH_DELIVERY_ATTEMPTS}
        and (
          deliveries.status in ('received', 'failed')
          or (
            deliveries.status = 'processing'
            and deliveries.lease_expires_at <= now()
          )
        )
        and not exists (
          select 1
          from connector_sources
          join connector_installations
            on connector_installations.org_id = connector_sources.org_id
           and connector_installations.id = connector_sources.installation_id
           and connector_installations.provider = connector_sources.provider
          join connector_sync_runs
            on connector_sync_runs.org_id = connector_sources.org_id
           and connector_sync_runs.connector_source_id = connector_sources.id
          where connector_sources.provider = 'github'
            and connector_sources.external_resource_id = deliveries.external_resource_id
            and connector_installations.external_installation_id = deliveries.external_installation_id
            and (
              (
                connector_sync_runs.status = 'running'
                and connector_sync_runs.lease_expires_at > now()
              )
              or (
                connector_sync_runs.idempotency_key = 'github-delivery:' || deliveries.delivery_id
                and connector_sync_runs.status = 'failed'
                and connector_sync_runs.retry_after > now()
              )
            )
        )
      order by deliveries.received_at asc, deliveries.id asc
      for update skip locked
      limit ${limit}
    )
    update connector_webhook_deliveries deliveries
    set
      status = 'processing',
      attempt_count = deliveries.attempt_count + 1,
      processing_started_at = now(),
      lease_expires_at = now() + (${GITHUB_WEBHOOK_LEASE_MINUTES} * interval '1 minute'),
      processed_at = null,
      error_code = null
    from candidates
    where deliveries.id = candidates.id
      and deliveries.provider = 'github'
      and deliveries.event_name = 'push'
      and deliveries.attempt_count < ${MAX_GITHUB_PUSH_DELIVERY_ATTEMPTS}
    returning
      deliveries.id,
      deliveries.delivery_id,
      deliveries.event_name,
      deliveries.payload_sha256,
      deliveries.attempt_count
  `;

  return rows.map((row) => ({
    id: row.id as string,
    deliveryId: row.delivery_id as string,
    eventName: row.event_name as string,
    payloadDigest: row.payload_sha256 as string,
    // Recovery intentionally has no webhook body. Push processing resolves the
    // exact connector from the canonical IDs persisted on this delivery row.
    payload: {},
    attemptCount: Number(row.attempt_count),
    duplicate: false,
    ledgerStatus: "processing",
  }));
}

/**
 * Finds connector registrations whose fire-and-forget initial sync never
 * established a healthy source. The stable key gives this recovery lane one
 * bounded retry series per connector generation; normal sync idempotency and
 * lease fencing still own the actual claim.
 */
export async function listRecoverableGitHubInitialSyncs(input: {
  limit?: number;
  sql?: Sql;
} = {}): Promise<RecoverableGitHubInitialSync[]> {
  const sql = input.sql ?? getSql();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 1), 1), 5);
  const rows = await sql`
    select connector_sources.id, connector_sources.generation
    from connector_sources
    join connector_installations
      on connector_installations.org_id = connector_sources.org_id
     and connector_installations.id = connector_sources.installation_id
     and connector_installations.provider = connector_sources.provider
    where connector_sources.provider = 'github'
      and connector_sources.status = 'active'
      and connector_installations.status = 'active'
      and connector_sources.last_success_at is null
      and connector_sources.health_status in ('pending', 'degraded')
      and not exists (
        select 1
        from connector_sync_runs
        where connector_sync_runs.org_id = connector_sources.org_id
          and connector_sync_runs.connector_source_id = connector_sources.id
          and connector_sync_runs.status = 'running'
          and connector_sync_runs.lease_expires_at > now()
      )
      and not exists (
        select 1
        from connector_sync_runs
        where connector_sync_runs.org_id = connector_sources.org_id
          and connector_sync_runs.connector_source_id = connector_sources.id
          and connector_sync_runs.status = 'failed'
          and connector_sync_runs.retry_after > now()
      )
      and coalesce((
        select max(connector_sync_runs.attempt_number)
        from connector_sync_runs
        where connector_sync_runs.org_id = connector_sources.org_id
          and connector_sync_runs.connector_source_id = connector_sources.id
          and connector_sync_runs.idempotency_key =
            'github-initial:' || connector_sources.id::text || ':generation:' || connector_sources.generation::text
      ), 0) < ${MAX_GITHUB_INITIAL_SYNC_ATTEMPTS}
    order by connector_sources.updated_at asc, connector_sources.id asc
    limit ${limit}
  `;

  return rows.map((row) => {
    const connectorId = row.id as string;
    const generation = Number(row.generation);
    return {
      connectorId,
      generation,
      idempotencyKey: `github-initial:${connectorId}:generation:${generation}`,
    };
  });
}

async function connectorForStoredPushDelivery(
  claim: ClaimedGitHubWebhook,
  sql: Sql,
): Promise<{ id: string; org_id: string; source_ref: string } | null> {
  const [connector] = await sql`
    select connector_sources.id, connector_sources.org_id, connector_sources.source_ref
    from connector_webhook_deliveries
    join connector_installations
      on connector_installations.provider = connector_webhook_deliveries.provider
     and connector_installations.external_installation_id = connector_webhook_deliveries.external_installation_id
    join connector_sources
      on connector_sources.org_id = connector_installations.org_id
     and connector_sources.installation_id = connector_installations.id
     and connector_sources.provider = connector_installations.provider
     and connector_sources.external_resource_id = connector_webhook_deliveries.external_resource_id
    where connector_webhook_deliveries.id = ${claim.id}
      and connector_webhook_deliveries.provider = 'github'
      and connector_webhook_deliveries.delivery_id = ${claim.deliveryId}
      and connector_webhook_deliveries.payload_sha256 = ${claim.payloadDigest}
      and connector_webhook_deliveries.event_name = 'push'
      and connector_webhook_deliveries.status = 'processing'
      and connector_webhook_deliveries.attempt_count = ${claim.attemptCount}
      limit 1
  `;
  return (connector as { id: string; org_id: string; source_ref: string } | undefined) ?? null;
}

async function connectorForWebhookPayload(
  payload: GitHubWebhookPayload,
  sql: Sql,
): Promise<{ id: string; org_id: string; source_ref: string } | null> {
  const installationId = safeExternalId(payload.installation?.id);
  const repositoryId = safeExternalId(payload.repository?.id);
  if (!installationId || !repositoryId) return null;
  const [connector] = await sql`
    select connector_sources.id, connector_sources.org_id, connector_sources.source_ref
    from connector_sources
    join connector_installations
      on connector_installations.org_id = connector_sources.org_id
     and connector_installations.id = connector_sources.installation_id
     and connector_installations.provider = connector_sources.provider
    where connector_sources.provider = 'github'
      and connector_sources.external_resource_id = ${repositoryId}
      and connector_installations.external_installation_id = ${installationId}
    limit 1
  `;
  return (connector as { id: string; org_id: string; source_ref: string } | undefined) ?? null;
}

async function markDelivery(input: {
  claim: ClaimedGitHubWebhook;
  status: "processed" | "ignored" | "failed";
  errorCode?: string | null;
  orgId?: string | null;
  connectorId?: string | null;
  sql: Sql;
}): Promise<void> {
  await input.sql`
    update connector_webhook_deliveries
    set
      status = ${input.status},
      error_code = ${input.errorCode ?? null},
      org_id = ${input.orgId ?? null},
      connector_source_id = ${input.connectorId ?? null},
      processed_at = now(),
      lease_expires_at = null
    where id = ${input.claim.id}
      and provider = 'github'
      and delivery_id = ${input.claim.deliveryId}
      and payload_sha256 = ${input.claim.payloadDigest}
      and status = 'processing'
      and attempt_count = ${input.claim.attemptCount}
  `;
}

async function connectorsForInstallation(
  installationId: string,
  sql: Sql,
): Promise<Array<{ id: string; org_id: string }>> {
  return (await sql`
    select connector_sources.id, connector_sources.org_id
    from connector_sources
    join connector_installations
      on connector_installations.org_id = connector_sources.org_id
     and connector_installations.id = connector_sources.installation_id
     and connector_installations.provider = connector_sources.provider
    where connector_sources.provider = 'github'
      and connector_installations.external_installation_id = ${installationId}
  `) as Array<{ id: string; org_id: string }>;
}

export async function processClaimedGitHubWebhook(
  claim: ClaimedGitHubWebhook,
  sqlOverride?: Sql,
): Promise<GitHubWebhookProcessOutcome> {
  if (claim.duplicate) return "duplicate";
  const sql = sqlOverride ?? getSql();
  try {
    if (claim.eventName === "ping") {
      await markDelivery({ claim, status: "processed", sql });
      return "processed";
    }

    if (claim.eventName === "push") {
      const connector = await connectorForStoredPushDelivery(claim, sql);
      if (!connector) {
        await markDelivery({ claim, status: "ignored", errorCode: "connector_not_registered", sql });
        return "ignored";
      }
      const result = await syncGitHubConnectorWithManagedAuthority({
        connectorId: connector.id,
        triggerKind: "webhook",
        idempotencyKey: `github-delivery:${claim.deliveryId}`,
        requestId: `github-webhook:${claim.deliveryId}`,
        sql,
      });
      if (result.authorization_receipt.decision !== "allow" || !result.sync_run) {
        await markDelivery({ claim, status: "failed", errorCode: "authorization_denied", orgId: connector.org_id, connectorId: connector.id, sql });
        return "failed";
      }
      if (result.sync_run.status === "running" || result.sync_run.status === "failed") {
        await markDelivery({
          claim,
          status: "failed",
          errorCode: result.sync_run.status === "running" ? "connector_sync_in_progress" : "connector_sync_failed",
          orgId: connector.org_id,
          connectorId: connector.id,
          sql,
        });
        return "failed";
      }
      await markDelivery({ claim, status: "processed", orgId: connector.org_id, connectorId: connector.id, sql });
      return "processed";
    }

    if (claim.eventName === "installation") {
      const installationId = safeExternalId(claim.payload.installation?.id);
      if (!installationId) throw new GitHubConnectorError("github_installation_id_invalid", 400);
      const connectors = await connectorsForInstallation(installationId, sql);
      const orgIds = [...new Set(connectors.map((connector) => connector.org_id))];
      if (claim.payload.action === "suspend" || claim.payload.action === "deleted") {
        await sql`
          update connector_installations
          set status = ${claim.payload.action === "deleted" ? "revoked" : "suspended"}, updated_at = now()
          where provider = 'github' and external_installation_id = ${installationId}
        `;
        for (const connector of connectors) {
          await revokeGitHubConnectorFromProvider(connector.id, "installation_revoked", sql);
        }
      } else if (claim.payload.action === "unsuspend") {
        // Restore only the installation boundary. Individual sources and their
        // managed credentials stay revoked until an admin explicitly reconnects.
        await sql`
          update connector_installations
          set status = 'active', updated_at = now()
          where provider = 'github' and external_installation_id = ${installationId}
        `;
      } else {
        await markDelivery({ claim, status: "ignored", errorCode: "event_action_not_supported", orgId: orgIds[0], sql });
        return "ignored";
      }
      await markDelivery({ claim, status: "processed", orgId: orgIds.length === 1 ? orgIds[0] : null, sql });
      return "processed";
    }

    if (claim.eventName === "installation_repositories") {
      const installationId = safeExternalId(claim.payload.installation?.id);
      if (!installationId) throw new GitHubConnectorError("github_installation_id_invalid", 400);
      const removedIds = new Set((claim.payload.repositories_removed ?? []).map((item) => safeExternalId(item.id)).filter(Boolean));
      if (removedIds.size === 0) {
        await markDelivery({ claim, status: "ignored", errorCode: "no_registered_repository_removed", sql });
        return "ignored";
      }
      const rows = await sql`
        select connector_sources.id, connector_sources.org_id
        from connector_sources
        join connector_installations
          on connector_installations.org_id = connector_sources.org_id
         and connector_installations.id = connector_sources.installation_id
         and connector_installations.provider = connector_sources.provider
        where connector_sources.provider = 'github'
          and connector_installations.external_installation_id = ${installationId}
          and connector_sources.external_resource_id = any(${[...removedIds]}::text[])
      `;
      for (const row of rows) await revokeGitHubConnectorFromProvider(row.id as string, "repository_removed", sql);
      const orgIds = [...new Set(rows.map((row) => row.org_id as string))];
      await markDelivery({
        claim,
        status: rows.length > 0 ? "processed" : "ignored",
        errorCode: rows.length > 0 ? null : "connector_not_registered",
        orgId: orgIds.length === 1 ? orgIds[0] : null,
        sql,
      });
      return rows.length > 0 ? "processed" : "ignored";
    }

    if (claim.eventName === "repository" && ["deleted", "archived", "transferred"].includes(claim.payload.action ?? "")) {
      const connector = await connectorForWebhookPayload(claim.payload, sql);
      if (!connector) {
        await markDelivery({ claim, status: "ignored", errorCode: "connector_not_registered", sql });
        return "ignored";
      }
      await revokeGitHubConnectorFromProvider(connector.id, "repository_deleted", sql);
      await markDelivery({ claim, status: "processed", orgId: connector.org_id, connectorId: connector.id, sql });
      return "processed";
    }

    await markDelivery({ claim, status: "ignored", errorCode: "event_not_supported", sql });
    return "ignored";
  } catch (error) {
    const baseCode = webhookErrorCode(error);
    const errorCode = claim.eventName === "push" && claim.attemptCount >= MAX_GITHUB_PUSH_DELIVERY_ATTEMPTS
      ? `retry_exhausted.${baseCode}`.slice(0, 120)
      : baseCode;
    await markDelivery({ claim, status: "failed", errorCode, sql }).catch(() => undefined);
    throw error;
  }
}
