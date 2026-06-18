import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import type { PrototypeAuthContext } from "@/lib/prototype/auth";

export type PrototypeAuditInput = {
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
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
