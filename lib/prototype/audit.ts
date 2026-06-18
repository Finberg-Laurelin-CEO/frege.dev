import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import type { PrototypeAuthContext } from "@/lib/prototype/auth";
import type { AuditEvent } from "@/lib/prototype/types";

export type PrototypeAuditInput = {
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

export type PrototypeAuditQuery = {
  action?: string;
  resourceType?: string;
  before?: string;
  limit: number;
};

export type PrototypeAuditEventResult = AuditEvent & {
  actor_key: {
    id: string;
    name: string;
    prefix: string;
  } | null;
};

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function hashIp(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.IP_HASH_SALT ?? "frege-default-salt";
  return createHash("sha256").update(`${ip}|${day}|${salt}`).digest("hex");
}

export async function logPrototypeAuditEvent(
  auth: PrototypeAuthContext,
  req: Request,
  input: PrototypeAuditInput,
): Promise<void> {
  const sql = getSql();

  await sql`
    insert into audit_events (
      org_id,
      actor_key_id,
      action,
      resource_type,
      resource_id,
      ip_hash,
      user_agent,
      metadata
    ) values (
      ${auth.organization.id},
      ${auth.key.id},
      ${input.action},
      ${input.resourceType ?? null},
      ${input.resourceId ?? null},
      ${hashIp(clientIp(req))},
      ${req.headers.get("user-agent")},
      ${JSON.stringify(input.metadata ?? {})}::jsonb
    )
  `;
}

export async function listPrototypeAuditEvents(
  auth: PrototypeAuthContext,
  query: PrototypeAuditQuery,
): Promise<PrototypeAuditEventResult[]> {
  const sql = getSql();
  const rows = await sql`
    select
      audit_events.id,
      audit_events.org_id,
      audit_events.actor_key_id,
      audit_events.action,
      audit_events.resource_type,
      audit_events.resource_id,
      audit_events.ip_hash,
      audit_events.user_agent,
      audit_events.metadata,
      audit_events.created_at,
      api_keys.name as actor_key_name,
      api_keys.key_prefix as actor_key_prefix
    from audit_events
    left join api_keys on api_keys.id = audit_events.actor_key_id
    where audit_events.org_id = ${auth.organization.id}
      and (${query.action ?? null}::text is null or audit_events.action = ${query.action ?? null})
      and (${query.resourceType ?? null}::text is null or audit_events.resource_type = ${query.resourceType ?? null})
      and (${query.before ?? null}::timestamptz is null or audit_events.created_at < ${query.before ?? null}::timestamptz)
    order by audit_events.created_at desc
    limit ${query.limit}
  `;

  return rows.map((row) => {
    const record = row as AuditEvent & {
      actor_key_name: string | null;
      actor_key_prefix: string | null;
    };

    return {
      id: record.id,
      org_id: record.org_id,
      actor_key_id: record.actor_key_id,
      action: record.action,
      resource_type: record.resource_type,
      resource_id: record.resource_id,
      ip_hash: record.ip_hash,
      user_agent: record.user_agent,
      metadata: record.metadata,
      created_at: record.created_at,
      actor_key: record.actor_key_id
        ? {
            id: record.actor_key_id,
            name: record.actor_key_name ?? "Unknown key",
            prefix: record.actor_key_prefix ?? "unknown",
          }
        : null,
    };
  });
}
