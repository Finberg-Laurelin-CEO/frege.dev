import { getSql } from "@/lib/db";
import { hashApiKey, parseApiKey, safelyCompareApiKeyHash } from "@/lib/prototype/keys";
import type { SensitivityLabel } from "@/lib/prototype/types";

export type PrototypeAuthContext = {
  organization: {
    id: string;
    slug: string;
    name: string;
  };
  role: {
    id: string;
    slug: string;
    name: string;
  };
  key: {
    id: string;
    name: string;
    prefix: string;
    owner_user_id: string | null;
    owner_user_email: string | null;
  };
  allowedLabels: SensitivityLabel[];
  capabilities: {
    canCreateDocs: boolean;
    canUpdateDocs: boolean;
    canReadAudit: boolean;
    canReadSessions: boolean;
    canWriteSessions: boolean;
    canProposeMemory: boolean;
    canReviewMemoryProposals: boolean;
    canManageSources: boolean;
    canExecuteAgents: boolean;
  };
};

type AuthRow = {
  key_id: string;
  key_name: string;
  key_prefix: string;
  key_hash: string;
  owner_user_id: string | null;
  owner_user_email: string | null;
  status: string;
  expires_at: Date | string | null;
  org_id: string;
  org_slug: string;
  org_name: string;
  role_id: string;
  role_slug: string;
  role_name: string;
  can_read_labels: SensitivityLabel[];
  can_create_docs: boolean;
  can_update_docs: boolean;
  can_read_audit: boolean;
  can_read_sessions: boolean | null;
  can_write_sessions: boolean | null;
  can_propose_memory: boolean | null;
  can_review_memory_proposals: boolean | null;
  can_manage_sources: boolean | null;
  can_execute_agents: boolean | null;
};

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  if (!authorization) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function isExpired(expiresAt: Date | string | null): boolean {
  if (!expiresAt) return false;

  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function toAuthContext(row: AuthRow): PrototypeAuthContext {
  return {
    organization: {
      id: row.org_id,
      slug: row.org_slug,
      name: row.org_name,
    },
    role: {
      id: row.role_id,
      slug: row.role_slug,
      name: row.role_name,
    },
    key: {
      id: row.key_id,
      name: row.key_name,
      prefix: row.key_prefix,
      owner_user_id: row.owner_user_id,
      owner_user_email: row.owner_user_email,
    },
    allowedLabels: row.can_read_labels,
    capabilities: {
      canCreateDocs: row.can_create_docs,
      canUpdateDocs: row.can_update_docs,
      canReadAudit: row.can_read_audit,
      canReadSessions: Boolean(row.can_read_sessions),
      canWriteSessions: row.can_write_sessions !== false,
      canProposeMemory: Boolean(row.can_propose_memory),
      canReviewMemoryProposals: Boolean(row.can_review_memory_proposals),
      canManageSources: Boolean(row.can_manage_sources),
      canExecuteAgents: Boolean(row.can_execute_agents),
    },
  };
}

export async function authenticatePrototypeRequest(req: Request): Promise<PrototypeAuthContext | null> {
  const rawKey = bearerToken(req);
  if (!rawKey) return null;

  const parsed = parseApiKey(rawKey);
  if (!parsed) return null;

  const sql = getSql();
  const rows = await sql`
    select
      api_keys.id as key_id,
      api_keys.name as key_name,
      api_keys.key_prefix,
      api_keys.key_hash,
      api_keys.owner_user_id,
      owner.email as owner_user_email,
      api_keys.status,
      api_keys.expires_at,
      organizations.id as org_id,
      organizations.slug as org_slug,
      organizations.name as org_name,
      roles.id as role_id,
      roles.slug as role_slug,
      roles.name as role_name,
      roles.can_read_labels,
      roles.can_create_docs,
      roles.can_update_docs,
      roles.can_read_audit,
      roles.can_read_sessions,
      roles.can_write_sessions,
      roles.can_propose_memory,
      roles.can_review_memory_proposals,
      roles.can_manage_sources,
      roles.can_execute_agents
    from api_keys
    join organizations on organizations.id = api_keys.org_id
    join roles on roles.id = api_keys.role_id and roles.org_id = api_keys.org_id
    left join users owner on owner.id = api_keys.owner_user_id
    where api_keys.key_prefix = ${parsed.keyPrefix}
    limit 1
  `;

  const row = rows[0] as AuthRow | undefined;
  if (!row) return null;
  if (row.status !== "active") return null;
  if (isExpired(row.expires_at)) return null;

  const candidateHash = hashApiKey(parsed.rawKey);
  if (!safelyCompareApiKeyHash(candidateHash, row.key_hash)) return null;

  await sql`
    update api_keys
    set last_used_at = now()
    where id = ${row.key_id}
  `;

  return toAuthContext(row);
}

export function prototypeUnauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
