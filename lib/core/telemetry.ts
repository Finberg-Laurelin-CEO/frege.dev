import { createHash, randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import type { PrototypeAuthContext } from "@/lib/core/auth";
import type { HumanOrgContext } from "@/lib/core/org-guard";
import type { TrustZone } from "@/lib/core/types";

export type TelemetryActor =
  | { type: "api_key"; auth: PrototypeAuthContext }
  | { type: "user"; auth: HumanOrgContext }
  | { type: "system"; orgId?: string };

export type TelemetryInput = {
  actor: TelemetryActor;
  req?: Request;
  requestId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  latencyMs?: number;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  trustZone?: TrustZone;
  sessionId?: string;
  sessionEventId?: string;
  contextBuildId?: string;
  proposalId?: string;
  metadata?: Record<string, unknown>;
};

export type TelemetryQuery = {
  action?: string;
  outcome?: string;
  actorType?: string;
  provider?: string;
  before?: string;
  limit: number;
};

const SENSITIVE_METADATA_KEYS = new Set([
  "api_key",
  "raw_key",
  "password",
  "token",
  "secret",
  "prompt",
  "body",
  "body_md",
  "proposed_body_md",
  "authorization",
]);

function clientIp(req?: Request): string {
  if (!req) return "system";
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function hashIp(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.IP_HASH_SALT;
  if (!salt && process.env.NODE_ENV === "production") {
    throw new Error("IP_HASH_SALT is not set");
  }
  return createHash("sha256").update(`${ip}|${day}|${salt ?? "frege-dev-salt"}`).digest("hex");
}

function orgIdForActor(actor: TelemetryActor): string | null {
  if (actor.type === "api_key") return actor.auth.organization.id;
  if (actor.type === "user") return actor.auth.organization.id;
  return actor.orgId ?? null;
}

function userIdForActor(actor: TelemetryActor): string | null {
  if (actor.type === "api_key") return actor.auth.key.owner_user_id;
  return actor.type === "user" ? actor.auth.user.id : null;
}

function keyIdForActor(actor: TelemetryActor): string | null {
  return actor.type === "api_key" ? actor.auth.key.id : null;
}

export function requestId(req?: Request): string {
  return req?.headers.get("x-request-id") ?? randomUUID();
}

export function sanitizeTelemetryMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) {
      output[key] = "[redacted]";
    } else if (typeof value === "string" && value.length > 512) {
      output[key] = `${value.slice(0, 512)}...`;
    } else {
      output[key] = value;
    }
  }

  return output;
}

export async function logTelemetryEvent(input: TelemetryInput): Promise<void> {
  try {
    const sql = getSql();
    await sql`
      insert into telemetry_events (
        org_id,
        actor_type,
        actor_user_id,
        actor_key_id,
        request_id,
        action,
        resource_type,
        resource_id,
        outcome,
        latency_ms,
        provider,
        model,
        input_tokens,
        output_tokens,
        estimated_cost_usd,
        trust_zone,
        ip_hash,
        user_agent,
        session_id,
        session_event_id,
        context_build_id,
        proposal_id,
        metadata
      ) values (
        ${orgIdForActor(input.actor)},
        ${input.actor.type},
        ${userIdForActor(input.actor)},
        ${keyIdForActor(input.actor)},
        ${input.requestId ?? requestId(input.req)},
        ${input.action},
        ${input.resourceType ?? null},
        ${input.resourceId ?? null},
        ${input.outcome},
        ${input.latencyMs ?? null},
        ${input.provider ?? null},
        ${input.model ?? null},
        ${input.inputTokens ?? null},
        ${input.outputTokens ?? null},
        ${input.estimatedCostUsd ?? null},
        ${input.trustZone ?? null},
        ${hashIp(clientIp(input.req))},
        ${input.req?.headers.get("user-agent") ?? null},
        ${input.sessionId ?? null},
        ${input.sessionEventId ?? null},
        ${input.contextBuildId ?? (input.resourceType === "context_build" ? input.resourceId ?? null : null)},
        ${input.proposalId ?? (input.resourceType === "memory_proposal" ? input.resourceId ?? null : null)},
        ${JSON.stringify(sanitizeTelemetryMetadata(input.metadata))}::jsonb
      )
    `;
  } catch (err) {
    console.error("telemetry write failed", {
      message: (err as Error)?.message,
    });
  }
}

export async function listTelemetryEvents(auth: HumanOrgContext, query: TelemetryQuery) {
  const sql = getSql();
  return sql`
    select
      telemetry_events.id,
      telemetry_events.actor_type,
      users.email as actor_user_email,
      api_keys.key_prefix as actor_key_prefix,
      telemetry_events.request_id,
      telemetry_events.action,
      telemetry_events.resource_type,
      telemetry_events.resource_id,
      telemetry_events.outcome,
      telemetry_events.latency_ms,
      telemetry_events.provider,
      telemetry_events.model,
      telemetry_events.input_tokens,
      telemetry_events.output_tokens,
      telemetry_events.estimated_cost_usd,
      telemetry_events.trust_zone,
      telemetry_events.session_id,
      telemetry_events.session_event_id,
      telemetry_events.context_build_id,
      telemetry_events.proposal_id,
      telemetry_events.metadata,
      telemetry_events.created_at
    from telemetry_events
    left join users on users.id = telemetry_events.actor_user_id
    left join api_keys on api_keys.id = telemetry_events.actor_key_id
    where telemetry_events.org_id = ${auth.organization.id}
      and (${query.action ?? null}::text is null or telemetry_events.action = ${query.action ?? null})
      and (${query.outcome ?? null}::text is null or telemetry_events.outcome = ${query.outcome ?? null})
      and (${query.actorType ?? null}::text is null or telemetry_events.actor_type = ${query.actorType ?? null})
      and (${query.provider ?? null}::text is null or telemetry_events.provider = ${query.provider ?? null})
      and (${query.before ?? null}::timestamptz is null or telemetry_events.created_at < ${query.before ?? null}::timestamptz)
    order by telemetry_events.created_at desc
    limit ${query.limit}
  `;
}

export async function telemetrySummary(auth: HumanOrgContext) {
  const sql = getSql();
  const [row] = await sql`
    select
      count(*)::int as total_events,
      count(*) filter (where outcome = 'denied')::int as denied_events,
      count(*) filter (where action = 'context.build')::int as context_builds,
      count(*) filter (where action = 'model.invoke')::int as model_calls,
      coalesce(sum(input_tokens), 0)::int as input_tokens,
      coalesce(sum(output_tokens), 0)::int as output_tokens,
      coalesce(sum(estimated_cost_usd), 0)::float as estimated_cost_usd,
      coalesce(avg(latency_ms), 0)::float as avg_latency_ms
    from telemetry_events
    where org_id = ${auth.organization.id}
      and created_at > now() - interval '7 days'
  `;

  return row ?? {
    total_events: 0,
    denied_events: 0,
    context_builds: 0,
    model_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
    avg_latency_ms: 0,
  };
}
