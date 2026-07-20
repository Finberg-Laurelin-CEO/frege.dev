import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { isBookkeepingTimestampStale, orgInactiveResponse } from "@/lib/core/auth";
import type { HumanOrgContext } from "@/lib/core/org-guard";
import { requestId as telemetryRequestId } from "@/lib/core/telemetry";
import type {
  AuthorizeRequestInput,
  CreateCredentialInput,
  CreatePolicyVersionInput,
  CreatePrincipalInput,
} from "@/lib/v2/contracts";
import { IDENTIFIER_PATTERN, policyRulesSchema, RESOURCE_ID_PATTERN } from "@/lib/v2/contracts";
import {
  bearerCredential,
  generateDelegatedCredential,
  hashDelegatedCredential,
  parseDelegatedCredential,
  safelyCompareDelegatedCredential,
} from "@/lib/v2/credentials";
import {
  digestPolicyRules,
  evaluateAuthorization,
  type AuthorizationEvaluation,
} from "@/lib/v2/policy-engine";
import type {
  AuthorizationReceipt,
  ControlPolicyVersion,
  ControlPrincipal,
  DelegatedCredential,
  PolicyRule,
  PrincipalType,
  ProvenanceEvent,
  V2CredentialAuthContext,
} from "@/lib/v2/types";

type Sql = ReturnType<typeof getSql>;

export class V2ControlPlaneError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "V2ControlPlaneError";
    this.code = code;
  }
}

function sqlClient(sql?: Sql): Sql {
  return sql ?? getSql();
}

function humanPrincipalSlug(userId: string): string {
  return `human-${userId.replaceAll("-", "").slice(0, 16)}`;
}

export async function ensureHumanPrincipal(auth: HumanOrgContext, sqlOverride?: Sql): Promise<ControlPrincipal> {
  const sql = sqlClient(sqlOverride);
  const [principal] = await sql`
    insert into control_principals (
      org_id,
      principal_type,
      slug,
      name,
      status,
      subject_user_id
    ) values (
      ${auth.organization.id},
      'human',
      ${humanPrincipalSlug(auth.user.id)},
      ${auth.user.name},
      'active',
      ${auth.user.id}
    )
    on conflict (org_id, subject_user_id) do update set
      name = excluded.name,
      updated_at = now()
    returning
      id, org_id, principal_type, slug, name, status,
      subject_user_id, subject_agent_id, created_by_principal_id,
      created_at, updated_at
  `;
  if ((principal as ControlPrincipal).status !== "active") {
    throw new V2ControlPlaneError("principal_inactive");
  }
  return principal as ControlPrincipal;
}

/** Stable bootstrap primitive for connector and other machine installations. */
export async function ensureServicePrincipal(
  input: {
    orgId: string;
    slug: string;
    name: string;
    createdByPrincipalId?: string | null;
  },
  sqlOverride?: Sql,
): Promise<ControlPrincipal> {
  const sql = sqlClient(sqlOverride);
  const [principal] = await sql`
    insert into control_principals (
      org_id,
      principal_type,
      slug,
      name,
      status,
      created_by_principal_id
    ) values (
      ${input.orgId},
      'service',
      ${input.slug},
      ${input.name},
      'active',
      ${input.createdByPrincipalId ?? null}
    )
    on conflict (org_id, slug) do update set
      name = excluded.name,
      updated_at = now()
    where control_principals.principal_type = 'service'
    returning
      id, org_id, principal_type, slug, name, status,
      subject_user_id, subject_agent_id, created_by_principal_id,
      created_at, updated_at
  `;
  if (!principal) throw new V2ControlPlaneError("principal_slug_conflict");
  if ((principal as ControlPrincipal).status !== "active") {
    throw new V2ControlPlaneError("principal_inactive");
  }
  return principal as ControlPrincipal;
}

export async function listPrincipals(orgId: string, sqlOverride?: Sql): Promise<ControlPrincipal[]> {
  const sql = sqlClient(sqlOverride);
  return (await sql`
    select
      id, org_id, principal_type, slug, name, status,
      subject_user_id, subject_agent_id, created_by_principal_id,
      created_at, updated_at
    from control_principals
    where org_id = ${orgId}
    order by principal_type asc, slug asc
    limit 500
  `) as ControlPrincipal[];
}

export async function createPrincipal(
  auth: HumanOrgContext,
  input: CreatePrincipalInput,
  sqlOverride?: Sql,
): Promise<ControlPrincipal> {
  const sql = sqlClient(sqlOverride);
  if (input.principal_type === "human") {
    const [member] = await sql`
      select memberships.user_id
      from organization_memberships memberships
      join users on users.id = memberships.user_id
      where memberships.org_id = ${auth.organization.id}
        and memberships.user_id = ${input.subject_user_id!}
        and memberships.status = 'active'
        and users.status = 'active'
      limit 1
    `;
    if (!member) throw new V2ControlPlaneError("subject_not_found");
  }

  if (input.subject_agent_id) {
    const [agent] = await sql`
      select id
      from agent_definitions
      where org_id = ${auth.organization.id}
        and id = ${input.subject_agent_id}
      limit 1
    `;
    if (!agent) throw new V2ControlPlaneError("subject_not_found");
  }

  const creator = await ensureHumanPrincipal(auth, sql);
  const [principal] = await sql`
    insert into control_principals (
      org_id,
      principal_type,
      slug,
      name,
      subject_user_id,
      subject_agent_id,
      created_by_principal_id
    ) values (
      ${auth.organization.id},
      ${input.principal_type},
      ${input.slug},
      ${input.name},
      ${input.subject_user_id ?? null},
      ${input.subject_agent_id ?? null},
      ${creator.id}
    )
    returning
      id, org_id, principal_type, slug, name, status,
      subject_user_id, subject_agent_id, created_by_principal_id,
      created_at, updated_at
  `;
  return principal as ControlPrincipal;
}

export async function listPolicyVersions(orgId: string, sqlOverride?: Sql): Promise<ControlPolicyVersion[]> {
  const sql = sqlClient(sqlOverride);
  return (await sql`
    select
      id, org_id, slug, version, default_decision, rules, rules_digest,
      created_by_principal_id, created_at
    from control_policy_versions
    where org_id = ${orgId}
    order by slug asc, version desc
    limit 500
  `) as ControlPolicyVersion[];
}

export async function createPolicyVersion(
  auth: HumanOrgContext,
  input: CreatePolicyVersionInput,
  sqlOverride?: Sql,
): Promise<ControlPolicyVersion> {
  const sql = sqlClient(sqlOverride);
  const principalIds = [...new Set(input.rules.flatMap((rule) => rule.principal_ids ?? []))];
  if (principalIds.length > 0) {
    const rows = await sql`
      select id
      from control_principals
      where org_id = ${auth.organization.id}
        and id = any(${principalIds}::uuid[])
    `;
    if (rows.length !== principalIds.length) throw new V2ControlPlaneError("principal_not_found");
  }

  const creator = await ensureHumanPrincipal(auth, sql);
  const digest = digestPolicyRules(input.rules);
  const [policy] = await sql`
    insert into control_policy_versions (
      org_id,
      slug,
      version,
      default_decision,
      rules,
      rules_digest,
      created_by_principal_id
    )
    select
      ${auth.organization.id},
      ${input.slug},
      current_version.version + 1,
      'deny',
      ${JSON.stringify(input.rules)}::jsonb,
      ${digest},
      ${creator.id}
    from (
      select coalesce(max(version), 0)::int as version
      from control_policy_versions
      where org_id = ${auth.organization.id}
        and slug = ${input.slug}
    ) current_version
    where ${input.expected_current_version ?? null}::int is null
       or current_version.version = ${input.expected_current_version ?? null}::int
    returning
      id, org_id, slug, version, default_decision, rules, rules_digest,
      created_by_principal_id, created_at
  `;
  if (!policy) throw new V2ControlPlaneError("policy_version_conflict");
  return policy as ControlPolicyVersion;
}

type CredentialListRow = DelegatedCredential & {
  principal_slug: string;
  principal_name: string;
  principal_type: PrincipalType;
  policy_slug: string;
  policy_version: number;
  policy_rules_digest: string;
};

export async function listDelegatedCredentials(
  orgId: string,
  principalId?: string,
  sqlOverride?: Sql,
): Promise<CredentialListRow[]> {
  const sql = sqlClient(sqlOverride);
  return (await sql`
    select
      credentials.id,
      credentials.org_id,
      credentials.principal_id,
      credentials.delegated_by_principal_id,
      credentials.policy_version_id,
      credentials.name,
      credentials.key_prefix,
      credentials.scopes,
      credentials.status,
      credentials.not_before,
      credentials.expires_at,
      credentials.last_used_at,
      credentials.revoked_at,
      credentials.created_at,
      principals.slug as principal_slug,
      principals.name as principal_name,
      principals.principal_type,
      policies.slug as policy_slug,
      policies.version as policy_version,
      policies.rules_digest as policy_rules_digest
    from delegated_credentials credentials
    join control_principals principals
      on principals.org_id = credentials.org_id
     and principals.id = credentials.principal_id
    join control_policy_versions policies
      on policies.org_id = credentials.org_id
     and policies.id = credentials.policy_version_id
    where credentials.org_id = ${orgId}
      and (${principalId ?? null}::uuid is null or credentials.principal_id = ${principalId ?? null}::uuid)
    order by credentials.created_at desc
    limit 500
  `) as CredentialListRow[];
}

export async function createDelegatedCredential(
  auth: HumanOrgContext,
  input: CreateCredentialInput,
  sqlOverride?: Sql,
): Promise<{ credential: CredentialListRow; rawCredential: string }> {
  const sql = sqlClient(sqlOverride);
  const [target] = await sql`
    select
      principals.id,
      principals.principal_type,
      principals.slug,
      principals.name,
      principals.status,
      principals.subject_user_id,
      principals.subject_agent_id,
      case
        when principals.principal_type = 'human' then exists (
          select 1
          from organization_memberships memberships
          join users on users.id = memberships.user_id
          where memberships.org_id = principals.org_id
            and memberships.user_id = principals.subject_user_id
            and memberships.status = 'active'
            and users.status = 'active'
        )
        when principals.principal_type = 'agent' and principals.subject_agent_id is not null then exists (
          select 1
          from agent_definitions agents
          where agents.org_id = principals.org_id
            and agents.id = principals.subject_agent_id
            and agents.status = 'active'
        )
        else true
      end as subject_active
    from control_principals principals
    where principals.org_id = ${auth.organization.id}
      and principals.id = ${input.principal_id}
    limit 1
  `;
  if (!target) throw new V2ControlPlaneError("principal_not_found");
  if (target.status !== "active" || !target.subject_active) {
    throw new V2ControlPlaneError("principal_inactive");
  }

  const [policy] = await sql`
    select id, slug, version, rules_digest
    from control_policy_versions
    where org_id = ${auth.organization.id}
      and id = ${input.policy_version_id}
    limit 1
  `;
  if (!policy) throw new V2ControlPlaneError("policy_not_found");

  const delegator = await ensureHumanPrincipal(auth, sql);
  const generated = generateDelegatedCredential();
  const [credential] = await sql`
    insert into delegated_credentials (
      org_id,
      principal_id,
      delegated_by_principal_id,
      policy_version_id,
      name,
      key_prefix,
      key_hash,
      scopes,
      not_before,
      expires_at
    ) values (
      ${auth.organization.id},
      ${input.principal_id},
      ${delegator.id},
      ${input.policy_version_id},
      ${input.name},
      ${generated.keyPrefix},
      ${generated.keyHash},
      ${input.scopes},
      ${input.not_before ?? new Date().toISOString()},
      ${input.expires_at ?? null}
    )
    returning
      id, org_id, principal_id, delegated_by_principal_id,
      policy_version_id, name, key_prefix, scopes, status,
      not_before, expires_at, last_used_at, revoked_at, created_at
  `;

  return {
    credential: {
      ...(credential as DelegatedCredential),
      principal_slug: target.slug as string,
      principal_name: target.name as string,
      principal_type: target.principal_type as PrincipalType,
      policy_slug: policy.slug as string,
      policy_version: policy.version as number,
      policy_rules_digest: policy.rules_digest as string,
    },
    rawCredential: generated.rawCredential,
  };
}

export async function revokeDelegatedCredential(
  orgId: string,
  credentialId: string,
  sqlOverride?: Sql,
): Promise<DelegatedCredential | null> {
  const sql = sqlClient(sqlOverride);
  const [credential] = await sql`
    update delegated_credentials
    set status = 'revoked', revoked_at = coalesce(revoked_at, now())
    where org_id = ${orgId}
      and id = ${credentialId}
    returning
      id, org_id, principal_id, delegated_by_principal_id,
      policy_version_id, name, key_prefix, scopes, status,
      not_before, expires_at, last_used_at, revoked_at, created_at
  `;
  return (credential as DelegatedCredential | undefined) ?? null;
}

type V2CredentialAuthResult =
  | { ok: true; auth: V2CredentialAuthContext }
  | { ok: false; response: Response };

type CredentialAuthRow = {
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: string;
  principal_id: string;
  principal_type: PrincipalType;
  principal_slug: string;
  principal_name: string;
  principal_status: "active" | "disabled";
  subject_user_id: string | null;
  subject_agent_id: string | null;
  subject_active: boolean;
  principal_created_by: string | null;
  principal_created_at: Date | string;
  principal_updated_at: Date | string;
  credential_id: string;
  credential_name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  credential_status: "active" | "revoked";
  delegated_by_principal_id: string;
  not_before: Date | string;
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  credential_created_at: Date | string;
  policy_id: string;
  policy_slug: string;
  policy_version: number;
  default_decision: string;
  policy_rules: unknown;
  rules_digest: string;
  policy_created_by: string | null;
  policy_created_at: Date | string;
};

function credentialWindowIsActive(row: CredentialAuthRow, now = Date.now()): boolean {
  const notBefore = new Date(row.not_before).getTime();
  if (!Number.isFinite(notBefore) || notBefore > now) return false;
  if (row.expires_at === null) return true;
  const expiresAt = new Date(row.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function credentialIdentityIsActive(row: CredentialAuthRow): boolean {
  return (
    row.org_status === "active" &&
    row.credential_status === "active" &&
    row.principal_status === "active" &&
    row.subject_active === true &&
    credentialWindowIsActive(row)
  );
}

function authContextFromCredentialRow(row: CredentialAuthRow): V2CredentialAuthContext {
  const parsedRules = policyRulesSchema.safeParse(row.policy_rules);
  const rules = parsedRules.success ? parsedRules.data : [];
  const digestMatches = parsedRules.success && digestPolicyRules(rules) === row.rules_digest;
  const policyValid = digestMatches && row.default_decision === "deny";

  return {
    organization: {
      id: row.org_id,
      slug: row.org_slug,
      name: row.org_name,
      status: row.org_status,
    },
    principal: {
      id: row.principal_id,
      org_id: row.org_id,
      principal_type: row.principal_type,
      slug: row.principal_slug,
      name: row.principal_name,
      status: row.principal_status,
      subject_user_id: row.subject_user_id,
      subject_agent_id: row.subject_agent_id,
      created_by_principal_id: row.principal_created_by,
      created_at: row.principal_created_at,
      updated_at: row.principal_updated_at,
    },
    credential: {
      id: row.credential_id,
      org_id: row.org_id,
      principal_id: row.principal_id,
      delegated_by_principal_id: row.delegated_by_principal_id,
      policy_version_id: row.policy_id,
      name: row.credential_name,
      key_prefix: row.key_prefix,
      scopes: row.scopes,
      status: row.credential_status,
      not_before: row.not_before,
      expires_at: row.expires_at,
      last_used_at: row.last_used_at,
      revoked_at: row.revoked_at,
      created_at: row.credential_created_at,
    },
    policy: {
      id: row.policy_id,
      org_id: row.org_id,
      slug: row.policy_slug,
      version: row.policy_version,
      default_decision: "deny",
      rules,
      rules_digest: row.rules_digest,
      created_by_principal_id: row.policy_created_by,
      created_at: row.policy_created_at,
      valid: policyValid,
    },
  };
}

async function touchDelegatedCredential(row: CredentialAuthRow, sql: Sql): Promise<void> {
  if (!isBookkeepingTimestampStale(row.last_used_at)) return;
  await sql`
    update delegated_credentials
    set last_used_at = now()
    where org_id = ${row.org_id}
      and id = ${row.credential_id}
  `;
}

export async function authenticateV2Credential(req: Request, sqlOverride?: Sql): Promise<V2CredentialAuthResult> {
  const raw = bearerCredential(req);
  if (!raw) return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  const parsedCredential = parseDelegatedCredential(raw);
  if (!parsedCredential) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const sql = sqlClient(sqlOverride);
  const [rowValue] = await sql`
    select *
    from v2_credential_auth_context
    where key_prefix = ${parsedCredential.keyPrefix}
    limit 1
  `;
  const row = rowValue as CredentialAuthRow | undefined;
  if (!row) return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };

  const candidateHash = hashDelegatedCredential(parsedCredential.rawCredential);
  if (!safelyCompareDelegatedCredential(candidateHash, row.key_hash)) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }

  if (!credentialIdentityIsActive(row) && row.org_status === "active") {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (row.org_status !== "active") {
    return { ok: false, response: orgInactiveResponse(row.org_status) };
  }

  await touchDelegatedCredential(row, sql);

  return {
    ok: true,
    auth: authContextFromCredentialRow(row),
  };
}

/**
 * Load a server-managed credential using only trusted persisted foreign keys.
 * Never pass request-body/query selectors here: connector code must load these
 * three IDs from same-tenant connector rows first. Unlike bearer auth, this
 * returns null unless identity, time window, default-deny policy, and digest are
 * all valid.
 */
export async function loadInternalV2CredentialAuth(
  input: { orgId: string; credentialId: string; principalId: string },
  sqlOverride?: Sql,
): Promise<V2CredentialAuthContext | null> {
  const sql = sqlClient(sqlOverride);
  const [rowValue] = await sql`
    select *
    from v2_credential_auth_context
    where org_id = ${input.orgId}
      and credential_id = ${input.credentialId}
      and principal_id = ${input.principalId}
    limit 1
  `;
  const row = rowValue as CredentialAuthRow | undefined;
  if (
    !row ||
    row.org_id !== input.orgId ||
    row.credential_id !== input.credentialId ||
    row.principal_id !== input.principalId ||
    !credentialIdentityIsActive(row)
  ) {
    return null;
  }
  const auth = authContextFromCredentialRow(row);
  if (!auth.policy.valid) return null;
  await touchDelegatedCredential(row, sql);
  return auth;
}

const SENSITIVE_PROVENANCE_KEYS = new Set([
  "authorization",
  "password",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "raw_key",
  "raw_credential",
  "private_key",
  "prompt",
  "content",
  "body",
  "body_md",
]);

function normalizedProvenanceKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isSensitiveProvenanceKey(key: string): boolean {
  const normalized = normalizedProvenanceKey(key);
  if (SENSITIVE_PROVENANCE_KEYS.has(normalized)) return true;
  const segments = normalized.split("_");
  return segments.some((segment) => ["password", "secret", "token", "prompt", "content"].includes(segment));
}

export function sanitizeProvenancePayload(value: unknown, depth = 0): unknown {
  if (depth >= 5) return "[truncated]";
  if (typeof value === "string") return value.length > 512 ? `${value.slice(0, 512)}...` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeProvenancePayload(item, depth + 1));
  if (!value || typeof value !== "object") return String(value ?? "");

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    output[key] = isSensitiveProvenanceKey(key) ? "[redacted]" : sanitizeProvenancePayload(item, depth + 1);
  }
  return output;
}

export type AppendProvenanceInput = {
  orgId: string;
  principalId?: string | null;
  delegatedCredentialId?: string | null;
  eventType: string;
  action: string;
  resource?: { type: string; id?: string };
  outcome: "success" | "failure" | "allow" | "deny";
  authorizationReceiptId?: string | null;
  correlationId?: string;
  payload?: Record<string, unknown>;
};

function assertProvenanceIdentifiers(input: AppendProvenanceInput): void {
  if (!IDENTIFIER_PATTERN.test(input.eventType) || !IDENTIFIER_PATTERN.test(input.action)) {
    throw new V2ControlPlaneError("invalid_provenance_identifier");
  }
  if (input.resource && !IDENTIFIER_PATTERN.test(input.resource.type)) {
    throw new V2ControlPlaneError("invalid_resource_type");
  }
  if (input.resource?.id && !RESOURCE_ID_PATTERN.test(input.resource.id)) {
    throw new V2ControlPlaneError("invalid_resource_id");
  }
}

/** Append one canonical, org-scoped provenance event with recursive redaction. */
export async function appendProvenanceEvent(
  input: AppendProvenanceInput,
  sqlOverride?: Sql,
): Promise<{ id: string; correlation_id: string; created_at: Date | string }> {
  assertProvenanceIdentifiers(input);
  const sql = sqlClient(sqlOverride);
  const id = randomUUID();
  const correlationId = input.correlationId ?? randomUUID();
  const [event] = await sql`
    insert into provenance_events (
      id,
      org_id,
      principal_id,
      delegated_credential_id,
      event_type,
      action,
      resource_type,
      resource_id,
      outcome,
      authorization_receipt_id,
      correlation_id,
      payload
    ) values (
      ${id},
      ${input.orgId},
      ${input.principalId ?? null},
      ${input.delegatedCredentialId ?? null},
      ${input.eventType},
      ${input.action},
      ${input.resource?.type ?? null},
      ${input.resource?.id ?? null},
      ${input.outcome},
      ${input.authorizationReceiptId ?? null},
      ${correlationId},
      ${JSON.stringify(sanitizeProvenancePayload(input.payload ?? {}))}::jsonb
    )
    returning id, correlation_id, created_at
  `;
  return event as { id: string; correlation_id: string; created_at: Date | string };
}

type RecordDecisionInput = {
  auth: V2CredentialAuthContext;
  requestId: string;
  correlationId: string;
  action: string;
  resource: { type: string; id?: string };
  evaluation: AuthorizationEvaluation;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeRequestId(value: string): string {
  return RESOURCE_ID_PATTERN.test(value) ? value : randomUUID();
}

/** Atomically records the authorization receipt and its canonical provenance event. */
export async function recordAuthorizationDecision(
  input: RecordDecisionInput,
  sqlOverride?: Sql,
): Promise<AuthorizationReceipt> {
  if (!IDENTIFIER_PATTERN.test(input.action) || !IDENTIFIER_PATTERN.test(input.resource.type)) {
    throw new V2ControlPlaneError("invalid_authorization_identifier");
  }
  if (input.resource.id && !RESOURCE_ID_PATTERN.test(input.resource.id)) {
    throw new V2ControlPlaneError("invalid_resource_id");
  }
  if (!UUID_PATTERN.test(input.correlationId)) {
    throw new V2ControlPlaneError("invalid_correlation_id");
  }
  const requestId = safeRequestId(input.requestId);
  const sql = sqlClient(sqlOverride);
  const receiptId = randomUUID();
  const eventId = randomUUID();
  const statements = [
    sql`
      insert into authorization_receipts (
        id,
        org_id,
        principal_id,
        delegated_credential_id,
        policy_version_id,
        correlation_id,
        request_id,
        action,
        resource_type,
        resource_id,
        decision,
        matching_rule_id,
        reason_code
      ) values (
        ${receiptId},
        ${input.auth.organization.id},
        ${input.auth.principal.id},
        ${input.auth.credential.id},
        ${input.auth.policy.id},
        ${input.correlationId},
        ${requestId},
        ${input.action},
        ${input.resource.type},
        ${input.resource.id ?? null},
        ${input.evaluation.decision},
        ${input.evaluation.matchingRuleId},
        ${input.evaluation.reasonCode}
      )
      returning created_at
    `,
    sql`
      insert into provenance_events (
        id,
        org_id,
        principal_id,
        delegated_credential_id,
        event_type,
        action,
        resource_type,
        resource_id,
        outcome,
        authorization_receipt_id,
        correlation_id,
        payload
      ) values (
        ${eventId},
        ${input.auth.organization.id},
        ${input.auth.principal.id},
        ${input.auth.credential.id},
        'authorization.decision',
        ${input.action},
        ${input.resource.type},
        ${input.resource.id ?? null},
        ${input.evaluation.decision},
        ${receiptId},
        ${input.correlationId},
        ${JSON.stringify({
          decision: input.evaluation.decision,
          reason_code: input.evaluation.reasonCode,
          matching_rule_id: input.evaluation.matchingRuleId,
          policy_slug: input.auth.policy.slug,
          policy_version: input.auth.policy.version,
          policy_rules_digest: input.auth.policy.rules_digest,
        })}::jsonb
      )
      returning created_at
    `,
  ];
  const results = (await sql.transaction(statements)) as Array<Array<{ created_at: Date | string }>>;
  const createdAt = results[0]?.[0]?.created_at ?? new Date().toISOString();

  return {
    id: receiptId,
    org_id: input.auth.organization.id,
    principal: {
      id: input.auth.principal.id,
      type: input.auth.principal.principal_type,
    },
    delegated_credential_id: input.auth.credential.id,
    correlation_id: input.correlationId,
    request_id: requestId,
    action: input.action,
    resource: {
      type: input.resource.type,
      ...(input.resource.id ? { id: input.resource.id } : {}),
    },
    decision: input.evaluation.decision,
    policy: {
      id: input.auth.policy.id,
      slug: input.auth.policy.slug,
      version: input.auth.policy.version,
      rules_digest: input.auth.policy.rules_digest,
      matching_rule_id: input.evaluation.matchingRuleId,
    },
    reason_code: input.evaluation.reasonCode,
    created_at: createdAt,
  };
}

/**
 * Stable integration primitive: evaluate an org-owned resource and persist the
 * allow/deny evidence before returning. Connector adapters should call this
 * after resolving the resource's org_id from storage, never from caller input.
 */
export async function authorizeAndRecordV2Action(
  input: {
    auth: V2CredentialAuthContext;
    action: string;
    resource: { orgId: string; type: string; id?: string };
    requestId?: string;
    correlationId?: string;
    req?: Request;
  },
  sqlOverride?: Sql,
): Promise<AuthorizationReceipt> {
  const evaluation = evaluateAuthorization({
    orgId: input.auth.organization.id,
    principal: input.auth.principal,
    credential: input.auth.credential,
    policy: input.auth.policy,
    action: input.action,
    resource: input.resource,
  });
  return recordAuthorizationDecision(
    {
      auth: input.auth,
      requestId: input.requestId ?? telemetryRequestId(input.req),
      correlationId: input.correlationId ?? randomUUID(),
      action: input.action,
      resource: { type: input.resource.type, ...(input.resource.id ? { id: input.resource.id } : {}) },
      evaluation,
    },
    sqlOverride,
  );
}

type ReceiptQuery = {
  decision?: "allow" | "deny";
  principalId?: string;
  correlationId?: string;
  before?: string;
  limit: number;
};

export async function listAuthorizationReceipts(
  orgId: string,
  query: ReceiptQuery,
  sqlOverride?: Sql,
): Promise<AuthorizationReceipt[]> {
  const sql = sqlClient(sqlOverride);
  const rows = await sql`
    select
      receipts.id,
      receipts.org_id,
      receipts.principal_id,
      principals.principal_type,
      receipts.delegated_credential_id,
      receipts.correlation_id,
      receipts.request_id,
      receipts.action,
      receipts.resource_type,
      receipts.resource_id,
      receipts.decision,
      receipts.matching_rule_id,
      receipts.reason_code,
      receipts.policy_version_id,
      policies.slug as policy_slug,
      policies.version as policy_version,
      policies.rules_digest,
      receipts.created_at
    from authorization_receipts receipts
    join control_principals principals
      on principals.org_id = receipts.org_id
     and principals.id = receipts.principal_id
    join control_policy_versions policies
      on policies.org_id = receipts.org_id
     and policies.id = receipts.policy_version_id
    where receipts.org_id = ${orgId}
      and (${query.decision ?? null}::text is null or receipts.decision = ${query.decision ?? null})
      and (${query.principalId ?? null}::uuid is null or receipts.principal_id = ${query.principalId ?? null}::uuid)
      and (${query.correlationId ?? null}::uuid is null or receipts.correlation_id = ${query.correlationId ?? null}::uuid)
      and (${query.before ?? null}::timestamptz is null or receipts.created_at < ${query.before ?? null}::timestamptz)
    order by receipts.created_at desc
    limit ${query.limit}
  `;

  return rows.map((row) => ({
    id: row.id as string,
    org_id: row.org_id as string,
    principal: { id: row.principal_id as string, type: row.principal_type as PrincipalType },
    delegated_credential_id: row.delegated_credential_id as string,
    correlation_id: row.correlation_id as string,
    request_id: row.request_id as string,
    action: row.action as string,
    resource: {
      type: row.resource_type as string,
      ...(row.resource_id ? { id: row.resource_id as string } : {}),
    },
    decision: row.decision as "allow" | "deny",
    policy: {
      id: row.policy_version_id as string,
      slug: row.policy_slug as string,
      version: row.policy_version as number,
      rules_digest: row.rules_digest as string,
      matching_rule_id: (row.matching_rule_id as string | null) ?? null,
    },
    reason_code: row.reason_code as AuthorizationReceipt["reason_code"],
    created_at: row.created_at as Date | string,
  }));
}

type ProvenanceQuery = {
  source?: ProvenanceEvent["source"];
  action?: string;
  outcome?: ProvenanceEvent["outcome"];
  correlationId?: string;
  before?: string;
  limit: number;
};

export async function listUnifiedProvenanceEvents(
  orgId: string,
  query: ProvenanceQuery,
  sqlOverride?: Sql,
): Promise<ProvenanceEvent[]> {
  const sql = sqlClient(sqlOverride);
  return (await sql`
    select
      event_id,
      org_id,
      principal_id,
      principal_type,
      delegated_credential_id,
      event_type,
      action,
      resource_type,
      resource_id,
      outcome,
      authorization_receipt_id,
      correlation_id,
      payload,
      created_at,
      source
    from unified_provenance_events
    where org_id = ${orgId}
      and (${query.source ?? null}::text is null or source = ${query.source ?? null})
      and (${query.action ?? null}::text is null or action = ${query.action ?? null})
      and (${query.outcome ?? null}::text is null or outcome = ${query.outcome ?? null})
      and (${query.correlationId ?? null}::text is null or correlation_id = ${query.correlationId ?? null})
      and (${query.before ?? null}::timestamptz is null or created_at < ${query.before ?? null}::timestamptz)
    order by created_at desc
    limit ${query.limit}
  `) as ProvenanceEvent[];
}

/** Convenience wrapper for the public /authorize request shape. */
export async function authorizePublicRequest(
  auth: V2CredentialAuthContext,
  input: AuthorizeRequestInput,
  req: Request,
  sqlOverride?: Sql,
): Promise<AuthorizationReceipt> {
  return authorizeAndRecordV2Action(
    {
      auth,
      action: input.action,
      resource: {
        // The public endpoint accepts only an opaque, org-local resource ref.
        // It never accepts an org_id or resource content from the caller.
        orgId: auth.organization.id,
        type: input.resource.type,
        ...(input.resource.id ? { id: input.resource.id } : {}),
      },
      correlationId: input.correlation_id,
      req,
    },
    sqlOverride,
  );
}
