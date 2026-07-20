import { createHash, randomBytes, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
import { getSql } from "@/lib/db";
import type { HumanOrgContext } from "@/lib/core/org-guard";
import {
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GitHubApiError,
  GitHubAppClient,
} from "@/lib/core/github-app";
import { oauthCallbackBaseUrl } from "@/lib/core/public-url";
import {
  type GitHubConnectorConfig,
  type GitHubTreeEntry,
  githubPageSlug,
  githubSourceSlug,
  normalizeGitHubConnectorConfig,
  selectGitHubTreeEntries,
} from "@/lib/core/github-connector-contract";
import {
  appendProvenanceEvent,
  authorizeAndRecordV2Action,
  createDelegatedCredential,
  createPolicyVersion,
  ensureHumanPrincipal,
  ensureServicePrincipal,
  loadInternalV2CredentialAuth,
  revokeDelegatedCredential,
} from "@/lib/v2/control-plane";
import type { AuthorizationReceipt, V2CredentialAuthContext } from "@/lib/v2/types";

type Sql = ReturnType<typeof getSql>;

const GITHUB_PROVIDER = "github";
const SYNC_LEASE_MINUTES = 15;
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const MAX_SYNC_BYTES = 8 * 1024 * 1024;

const HIGH_CONFIDENCE_SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bfrg_live_[a-f0-9]{12}_[A-Za-z0-9_-]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{36,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
];

export class GitHubConnectorError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "GitHubConnectorError";
    this.code = code;
    this.status = status;
  }
}

const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const connectorConfigInputSchema = z
  .object({
    include: z.array(z.string().min(1).max(240)).max(64).optional(),
    exclude: z.array(z.string().min(1).max(240)).max(128).optional(),
    trust_zone: z.enum(["green", "red"]).optional(),
    max_files: z.number().int().positive().max(500).optional(),
    max_file_bytes: z.number().int().positive().max(512 * 1024).optional(),
  })
  .strict();

function safeGitRef(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.endsWith(".lock") &&
    !value.includes("..") &&
    !value.includes("//") &&
    !/[\u0000-\u0020~^:?*[\\]/.test(value)
  );
}

export const registerGitHubConnectorSchema = z
  .object({
    org_slug: z.string().trim().min(1).max(120),
    installation_id: positiveSafeInteger,
    repository_id: positiveSafeInteger,
    source_ref: z.string().trim().refine(safeGitRef, "invalid Git ref").optional(),
    config: connectorConfigInputSchema.optional(),
  })
  .strict();

export type RegisterGitHubConnectorInput = z.infer<typeof registerGitHubConnectorSchema>;

type GitHubInstallation = {
  id: number;
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  suspended_at: string | null;
  account: { id: number; login: string; type: string };
};

type GitHubRepository = {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  visibility: string;
  default_branch: string;
  archived: boolean;
  disabled: boolean;
  owner: { id: number; login: string };
};

type GitHubTree = {
  sha: string;
  truncated: boolean;
  tree: GitHubTreeEntry[];
};

type GitHubBlob = {
  sha: string;
  size: number;
  encoding: string;
  content: string;
};

export type GitHubConnectorRecord = {
  id: string;
  org_id: string;
  installation_id: string;
  external_installation_id: string;
  account_id: string;
  account_login: string;
  installation_status: "active" | "suspended" | "revoked";
  external_resource_id: string;
  display_name: string;
  source_id: string;
  source_slug: string;
  service_principal_id: string;
  managed_credential_id: string;
  policy_version_id: string;
  generation: number;
  source_ref: string;
  status: "active" | "disabled" | "revoked";
  health_status: "pending" | "healthy" | "degraded" | "revoked";
  config: GitHubConnectorConfig;
  external_acl: Record<string, unknown>;
  sync_cursor: string | null;
  etag: string | null;
  last_attempt_at: Date | string | null;
  last_success_at: Date | string | null;
  last_error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type GitHubSyncItem = {
  source_path: string;
  external_revision: string;
  status: "active" | "deleted";
  page_id: string;
  page_slug: string;
};

export type GitHubSyncPlan = {
  selected: GitHubTreeEntry[];
  fetch: GitHubTreeEntry[];
  unchanged: GitHubTreeEntry[];
  deleted: GitHubSyncItem[];
};

export type GitHubSyncRun = {
  id: string;
  org_id: string;
  connector_source_id: string;
  trigger_kind: "initial" | "manual" | "webhook" | "retry";
  status: "running" | "succeeded" | "noop" | "failed";
  idempotency_key: string;
  correlation_id: string;
  authorization_receipt_id: string;
  config_digest: string;
  connector_generation: number;
  lease_token: string;
  lease_expires_at: Date | string;
  snapshot_authoritative: boolean;
  deletion_applied: boolean;
  cursor_from: string | null;
  cursor_to: string | null;
  selected_count: number;
  fetched_count: number;
  created_count: number;
  updated_count: number;
  deleted_count: number;
  unchanged_count: number;
  error_code: string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
  retry_after: Date | string | null;
};

export function githubConnectorConfigDigest(
  config: GitHubConnectorConfig,
  sourceRef = "",
  connectorGeneration = 1,
): string {
  return createHash("sha256").update(JSON.stringify({
    include: config.include,
    exclude: config.exclude,
    trust_zone: config.trust_zone,
    max_files: config.max_files,
    max_file_bytes: config.max_file_bytes,
    source_ref: sourceRef,
    connector_generation: connectorGeneration,
  })).digest("hex");
}

export function githubAppClientFromEnvironment(): GitHubAppClient {
  const appId = process.env.FREGE_GITHUB_APP_ID?.trim();
  const privateKey = process.env.FREGE_GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !privateKey) throw new GitHubConnectorError("github_app_not_configured", 503);
  return new GitHubAppClient({ appId, privateKey });
}

function setupStateHash(rawState: string): string {
  return createHash("sha256").update(`frege-github-setup:${rawState}`).digest("hex");
}

export async function createGitHubSetupState(
  auth: HumanOrgContext,
  sqlOverride?: Sql,
): Promise<{ install_url: string; expires_at: string }> {
  const appSlug = process.env.FREGE_GITHUB_APP_SLUG?.trim();
  if (!appSlug || !/^[A-Za-z0-9-]{1,100}$/.test(appSlug)) {
    throw new GitHubConnectorError("github_app_slug_not_configured", 503);
  }
  const sql = sqlOverride ?? getSql();
  const rawState = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await sql.transaction([
    sql`
      delete from connector_setup_states
      where expires_at < now() - interval '1 day'
         or (consumed_at is not null and consumed_at < now() - interval '1 day')
    `,
    sql`
      insert into connector_setup_states (
        org_id, user_id, provider, state_hash, expires_at
      ) values (
        ${auth.organization.id},
        ${auth.user.id},
        ${GITHUB_PROVIDER},
        ${setupStateHash(rawState)},
        ${expiresAt}
      )
    `,
  ]);
  const installUrl = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  installUrl.searchParams.set("state", rawState);
  return { install_url: installUrl.toString(), expires_at: expiresAt };
}

export async function pendingGitHubSetupOrgSlug(
  userId: string,
  rawState: string,
  sqlOverride?: Sql,
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(rawState)) return null;
  const sql = sqlOverride ?? getSql();
  const [row] = await sql`
    select organizations.slug
    from connector_setup_states
    join organizations on organizations.id = connector_setup_states.org_id
    join organization_memberships memberships
      on memberships.org_id = connector_setup_states.org_id
     and memberships.user_id = connector_setup_states.user_id
    where connector_setup_states.user_id = ${userId}
      and connector_setup_states.provider = ${GITHUB_PROVIDER}
      and connector_setup_states.state_hash = ${setupStateHash(rawState)}
      and connector_setup_states.consumed_at is null
      and connector_setup_states.expires_at > now()
      and memberships.status = 'active'
      and memberships.role in ('owner', 'admin')
    limit 1
  `;
  return (row?.slug as string | undefined) ?? null;
}

function githubSetupOAuthConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FREGE_GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.FREGE_GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new GitHubConnectorError("github_user_authorization_not_configured", 503);
  }
  return { clientId, clientSecret };
}

export function githubSetupOAuthRedirectUri(host?: string | null): string {
  return `${oauthCallbackBaseUrl(host)}/api/v2/connectors/github/setup/verify`;
}

export async function beginGitHubSetupOwnershipVerification(
  auth: HumanOrgContext,
  input: { rawState: string; installationId: number; host?: string | null; client?: GitHubAppClient },
  sqlOverride?: Sql,
): Promise<{ authorize_url: string }> {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(input.rawState)) {
    throw new GitHubConnectorError("github_setup_state_invalid", 400);
  }
  const sql = sqlOverride ?? getSql();
  const client = input.client ?? githubAppClientFromEnvironment();
  const [state] = await sql`
    select id
    from connector_setup_states
    where org_id = ${auth.organization.id}
      and user_id = ${auth.user.id}
      and provider = ${GITHUB_PROVIDER}
      and state_hash = ${setupStateHash(input.rawState)}
      and consumed_at is null
      and expires_at > now()
    limit 1
  `;
  if (!state) throw new GitHubConnectorError("github_setup_state_invalid", 400);

  const installation = await githubJson<GitHubInstallation>(
    await client.requestAsApp(`/app/installations/${input.installationId}`),
    "github_installation_read_failed",
  );
  if (installation.id !== input.installationId || installation.suspended_at) {
    throw new GitHubConnectorError("github_installation_identity_mismatch", 409);
  }
  const [prepared] = await sql`
    update connector_setup_states
    set external_installation_id = ${String(installation.id)}
    where id = ${state.id}
      and org_id = ${auth.organization.id}
      and user_id = ${auth.user.id}
      and provider = ${GITHUB_PROVIDER}
      and consumed_at is null
      and expires_at > now()
      and (external_installation_id is null or external_installation_id = ${String(installation.id)})
    returning id
  `;
  if (!prepared) throw new GitHubConnectorError("github_setup_state_consumed", 409);

  const config = githubSetupOAuthConfig();
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", githubSetupOAuthRedirectUri(input.host));
  authorizeUrl.searchParams.set("state", input.rawState);
  return { authorize_url: authorizeUrl.toString() };
}

type GitHubUserRepositoryList = {
  total_count: number;
  repositories: Array<{ id: number }>;
};

async function revokeOneTimeGitHubUserToken(
  accessToken: string,
  config: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch,
): Promise<void> {
  await fetchImpl(`${GITHUB_API_BASE_URL}/applications/${encodeURIComponent(config.clientId)}/token`, {
    method: "DELETE",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "content-type": "application/json",
      "user-agent": "frege-github-connector",
      "x-github-api-version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({ access_token: accessToken }),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function completeGitHubSetupOwnershipVerification(
  auth: HumanOrgContext,
  input: {
    rawState: string;
    code: string;
    host?: string | null;
    client?: GitHubAppClient;
    fetchImpl?: typeof fetch;
  },
  sqlOverride?: Sql,
): Promise<{ installation_id: number; account_login: string; verified_repository_count: number }> {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(input.rawState) || input.code.length < 1 || input.code.length > 500) {
    throw new GitHubConnectorError("github_user_authorization_invalid", 400);
  }
  const sql = sqlOverride ?? getSql();
  const [state] = await sql`
    select id, external_installation_id
    from connector_setup_states
    where org_id = ${auth.organization.id}
      and user_id = ${auth.user.id}
      and provider = ${GITHUB_PROVIDER}
      and state_hash = ${setupStateHash(input.rawState)}
      and external_installation_id is not null
      and consumed_at is null
      and expires_at > now()
    limit 1
  `;
  if (!state) throw new GitHubConnectorError("github_setup_state_invalid", 400);
  const installationId = parsePositiveExternalId(
    state.external_installation_id as string,
    "github_installation_id_invalid",
  );
  const config = githubSetupOAuthConfig();
  const fetchImpl = input.fetchImpl ?? fetch;
  const tokenResponse = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      redirect_uri: githubSetupOAuthRedirectUri(input.host),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) throw new GitHubConnectorError("github_user_authorization_exchange_failed", 502);
  const tokenBody = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenBody.access_token || tokenBody.error) {
    throw new GitHubConnectorError("github_user_authorization_exchange_failed", 403);
  }

  const accessToken = tokenBody.access_token;
  try {
    const userHeaders = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "frege-github-connector",
      "x-github-api-version": GITHUB_API_VERSION,
    };
    const userResponse = await fetchImpl(`${GITHUB_API_BASE_URL}/user`, {
      headers: userHeaders,
      signal: AbortSignal.timeout(15_000),
    });
    if (!userResponse.ok) throw new GitHubConnectorError("github_user_authorization_failed", 403);
    const githubUser = await userResponse.json() as { id?: number };
    if (!Number.isSafeInteger(githubUser.id) || !githubUser.id) {
      throw new GitHubConnectorError("github_user_authorization_failed", 403);
    }

    const verifiedRepositoryIds: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const repositoriesResponse = await fetchImpl(
        `${GITHUB_API_BASE_URL}/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
        { headers: userHeaders, signal: AbortSignal.timeout(15_000) },
      );
      if (!repositoriesResponse.ok) {
        throw new GitHubConnectorError("github_installation_user_access_denied", 403);
      }
      const listing = await repositoriesResponse.json() as GitHubUserRepositoryList;
      if (!Array.isArray(listing.repositories) || !Number.isSafeInteger(listing.total_count)) {
        throw new GitHubConnectorError("github_user_repositories_invalid", 502);
      }
      for (const repository of listing.repositories) {
        if (Number.isSafeInteger(repository.id) && repository.id > 0) {
          verifiedRepositoryIds.push(String(repository.id));
        }
      }
      if (listing.repositories.length < 100 || verifiedRepositoryIds.length >= listing.total_count) break;
      if (page === 5) throw new GitHubConnectorError("github_verified_repository_limit_exceeded", 422);
    }
    if (verifiedRepositoryIds.length === 0) {
      throw new GitHubConnectorError("github_installation_has_no_accessible_repositories", 403);
    }

    const client = input.client ?? githubAppClientFromEnvironment();
    const installation = await githubJson<GitHubInstallation>(
      await client.requestAsApp(`/app/installations/${installationId}`),
      "github_installation_read_failed",
    );
    if (installation.id !== installationId || installation.suspended_at) {
      throw new GitHubConnectorError("github_installation_identity_mismatch", 409);
    }

    const creator = await ensureHumanPrincipal(auth, sql);
    const verifiedAt = new Date().toISOString();
    const verifiedAcl = {
      account_type: installation.account.type,
      repository_selection: installation.repository_selection,
      verified_repository_ids: [...new Set(verifiedRepositoryIds)],
      verified_by_github_user_id: String(githubUser.id),
      ownership_verified_at: verifiedAt,
    };
    const [bound] = await sql`
      with consumed_state as (
        update connector_setup_states
        set consumed_at = now()
        where id = ${state.id}
          and org_id = ${auth.organization.id}
          and user_id = ${auth.user.id}
          and provider = ${GITHUB_PROVIDER}
          and external_installation_id = ${String(installation.id)}
          and consumed_at is null
          and expires_at > now()
        returning id
      ), upserted_installation as (
        insert into connector_installations (
          org_id, provider, external_installation_id, account_id, account_login,
          status, requested_scopes, external_acl, created_by_principal_id
        )
        select
          ${auth.organization.id},
          ${GITHUB_PROVIDER},
          ${String(installation.id)},
          ${String(installation.account.id)},
          ${installation.account.login},
          'active',
          ${JSON.stringify({ contents: "read" })}::jsonb,
          ${JSON.stringify(verifiedAcl)}::jsonb,
          ${creator.id}
        from consumed_state
        on conflict (provider, external_installation_id) do update set
          account_id = excluded.account_id,
          account_login = excluded.account_login,
          status = 'active',
          requested_scopes = excluded.requested_scopes,
          external_acl = excluded.external_acl,
          updated_at = now()
        where connector_installations.org_id = excluded.org_id
        returning id
      )
      select
        (select id from consumed_state) as state_id,
        (select id from upserted_installation) as installation_id
    `;
    if (!bound?.state_id) throw new GitHubConnectorError("github_setup_state_consumed", 409);
    if (!bound.installation_id) throw new GitHubConnectorError("github_installation_already_connected", 409);
    return {
      installation_id: installation.id,
      account_login: installation.account.login,
      verified_repository_count: verifiedAcl.verified_repository_ids.length,
    };
  } finally {
    await revokeOneTimeGitHubUserToken(accessToken, config, fetchImpl).catch(() => undefined);
  }
}

function parsePositiveExternalId(value: string, code: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || String(number) !== value) {
    throw new GitHubConnectorError(code, 500);
  }
  return number;
}

async function githubJson<T>(response: Response, code: string): Promise<T> {
  if (!response.ok) throw new GitHubApiError(`${code}:${response.status}`, response);
  try {
    return await response.json() as T;
  } catch {
    throw new GitHubConnectorError(`${code}_invalid_json`, 502);
  }
}

function strictConnectorConfig(value: unknown): GitHubConnectorConfig {
  const parsed = connectorConfigInputSchema.safeParse(value ?? {});
  if (!parsed.success) throw new GitHubConnectorError("github_connector_config_invalid");
  try {
    return normalizeGitHubConnectorConfig(parsed.data);
  } catch (error) {
    throw new GitHubConnectorError((error as Error).message || "github_connector_config_invalid");
  }
}

function repositoryAcl(repository: GitHubRepository, installation: GitHubInstallation): Record<string, unknown> {
  return {
    mapping: "repository-bound",
    repository_private: repository.private,
    repository_visibility: repository.visibility,
    repository_owner_id: String(repository.owner.id),
    installation_account_id: String(installation.account.id),
    installation_account_type: installation.account.type,
    repository_selection: installation.repository_selection,
  };
}

async function verifyInstallationRepository(input: {
  client: GitHubAppClient;
  installationId: number;
  repositoryId: number;
}): Promise<{ installation: GitHubInstallation; repository: GitHubRepository }> {
  const installation = await githubJson<GitHubInstallation>(
    await input.client.requestAsApp(`/app/installations/${input.installationId}`),
    "github_installation_read_failed",
  );
  if (installation.id !== input.installationId || !installation.account?.id || !installation.account?.login) {
    throw new GitHubConnectorError("github_installation_identity_mismatch", 502);
  }
  if (installation.suspended_at) throw new GitHubConnectorError("github_installation_suspended", 409);
  if (installation.permissions?.contents !== "read" && installation.permissions?.contents !== "write") {
    throw new GitHubConnectorError("github_contents_permission_required", 409);
  }

  const token = await input.client.createInstallationToken({
    installationId: input.installationId,
    repositoryIds: [input.repositoryId],
    permissions: { contents: "read" },
  });
  const repository = await githubJson<GitHubRepository>(
    await input.client.request(token.token, `/repositories/${input.repositoryId}`),
    "github_repository_read_failed",
  );
  if (repository.id !== input.repositoryId || !repository.owner?.id || !repository.owner?.login) {
    throw new GitHubConnectorError("github_repository_identity_mismatch", 502);
  }
  if (repository.disabled) throw new GitHubConnectorError("github_repository_disabled", 409);
  return { installation, repository };
}

function normalizeConnectorRow(row: Record<string, unknown>): GitHubConnectorRecord {
  return {
    ...(row as unknown as GitHubConnectorRecord),
    config: strictConnectorConfig(row.config),
    external_acl: (row.external_acl && typeof row.external_acl === "object" ? row.external_acl : {}) as Record<string, unknown>,
  };
}

const connectorSelect = `
  select
    connector_sources.id,
    connector_sources.org_id,
    connector_sources.installation_id,
    connector_installations.external_installation_id,
    connector_installations.account_id,
    connector_installations.account_login,
    connector_installations.status as installation_status,
    connector_sources.external_resource_id,
    connector_sources.display_name,
    connector_sources.source_id,
    brain_sources.slug as source_slug,
    connector_sources.service_principal_id,
    connector_sources.managed_credential_id,
    connector_sources.policy_version_id,
    connector_sources.generation,
    connector_sources.source_ref,
    connector_sources.status,
    connector_sources.health_status,
    connector_sources.config,
    connector_sources.external_acl,
    connector_sources.sync_cursor,
    connector_sources.etag,
    connector_sources.last_attempt_at,
    connector_sources.last_success_at,
    connector_sources.last_error_code,
    connector_sources.created_at,
    connector_sources.updated_at
  from connector_sources
  join connector_installations
    on connector_installations.org_id = connector_sources.org_id
   and connector_installations.id = connector_sources.installation_id
  join brain_sources
    on brain_sources.org_id = connector_sources.org_id
   and brain_sources.id = connector_sources.source_id
`;

export async function getGitHubConnectorById(
  connectorId: string,
  sqlOverride?: Sql,
): Promise<GitHubConnectorRecord | null> {
  const sql = sqlOverride ?? getSql();
  const rows = await sql(
    `${connectorSelect}
     where connector_sources.provider = $1
       and connector_sources.id = $2
     limit 1`,
    [GITHUB_PROVIDER, connectorId],
  );
  return rows[0] ? normalizeConnectorRow(rows[0] as Record<string, unknown>) : null;
}

export async function listGitHubConnectors(
  orgId: string,
  sqlOverride?: Sql,
): Promise<GitHubConnectorRecord[]> {
  const sql = sqlOverride ?? getSql();
  const rows = await sql(
    `${connectorSelect}
     where connector_sources.provider = $1
       and connector_sources.org_id = $2
     order by connector_sources.updated_at desc
     limit 100`,
    [GITHUB_PROVIDER, orgId],
  );
  return rows.map((row) => normalizeConnectorRow(row as Record<string, unknown>));
}

export async function registerGitHubConnector(
  auth: HumanOrgContext,
  input: RegisterGitHubConnectorInput,
  options: { client?: GitHubAppClient; sql?: Sql } = {},
): Promise<{ connector: GitHubConnectorRecord; created: boolean }> {
  const sql = options.sql ?? getSql();
  const client = options.client ?? githubAppClientFromEnvironment();
  const config = strictConnectorConfig(input.config ?? {});

  // A repository may only be registered through an installation previously
  // bound to this organization by the signed, single-use setup callback. Do
  // this lookup before making any GitHub requests so arbitrary installation
  // IDs cannot be probed through the registration endpoint.
  const [boundInstallation] = await sql`
    select id, org_id, status, external_acl
    from connector_installations
    where provider = ${GITHUB_PROVIDER}
      and external_installation_id = ${String(input.installation_id)}
    limit 1
  `;
  if (!boundInstallation) throw new GitHubConnectorError("github_setup_required", 409);
  if (boundInstallation.org_id !== auth.organization.id) {
    throw new GitHubConnectorError("github_installation_already_connected", 409);
  }
  if (boundInstallation.status !== "active") {
    throw new GitHubConnectorError("github_installation_inactive", 409);
  }
  const verifiedRepositoryIds = (
    boundInstallation.external_acl && typeof boundInstallation.external_acl === "object"
      ? (boundInstallation.external_acl as { verified_repository_ids?: unknown }).verified_repository_ids
      : null
  );
  if (
    !Array.isArray(verifiedRepositoryIds) ||
    !verifiedRepositoryIds.includes(String(input.repository_id))
  ) {
    throw new GitHubConnectorError("github_repository_user_access_denied", 403);
  }

  const { installation, repository } = await verifyInstallationRepository({
    client,
    installationId: input.installation_id,
    repositoryId: input.repository_id,
  });
  const sourceRef = input.source_ref ?? repository.default_branch;
  if (!safeGitRef(sourceRef)) throw new GitHubConnectorError("github_ref_invalid");
  const acl = repositoryAcl(repository, installation);

  const [existingGlobal] = await sql`
    select
      id,
      org_id,
      status,
      service_principal_id,
      managed_credential_id,
      policy_version_id
    from connector_sources
    where provider = ${GITHUB_PROVIDER}
      and external_resource_id = ${String(repository.id)}
    limit 1
  `;
  if (existingGlobal && existingGlobal.org_id !== auth.organization.id) {
    throw new GitHubConnectorError("github_repository_already_connected", 409);
  }

  const creator = await ensureHumanPrincipal(auth, sql);
  const [installationRow] = await sql`
    update connector_installations
    set
      account_id = ${String(installation.account.id)},
      account_login = ${installation.account.login},
      requested_scopes = ${JSON.stringify({ contents: "read" })}::jsonb,
      external_acl = external_acl || ${JSON.stringify({
        account_type: installation.account.type,
        repository_selection: installation.repository_selection,
      })}::jsonb,
      created_by_principal_id = coalesce(created_by_principal_id, ${creator.id}),
      updated_at = now()
    where id = ${boundInstallation.id}
      and org_id = ${auth.organization.id}
      and provider = ${GITHUB_PROVIDER}
      and external_installation_id = ${String(installation.id)}
      and status = 'active'
    returning id, org_id
  `;
  if (!installationRow || installationRow.org_id !== auth.organization.id) {
    throw new GitHubConnectorError("github_installation_already_connected", 409);
  }

  if (existingGlobal) {
    let authorityReady = existingGlobal.status === "active";
    if (authorityReady) {
      try {
        const existingAuth = await loadInternalV2CredentialAuth({
          orgId: auth.organization.id,
          credentialId: existingGlobal.managed_credential_id as string,
          principalId: existingGlobal.service_principal_id as string,
        }, sql);
        authorityReady = existingAuth?.credential.policy_version_id === existingGlobal.policy_version_id;
      } catch {
        authorityReady = false;
      }
    }

    let replacement: {
      principalId: string;
      credentialId: string;
      policyVersionId: string;
    } | null = null;
    if (!authorityReady) {
      const reconnectSuffix = randomUUID().replaceAll("-", "").slice(0, 10);
      const service = await ensureServicePrincipal({
        orgId: auth.organization.id,
        slug: `github-${repository.id}-reconnect-${reconnectSuffix}`,
        name: `GitHub sync: ${repository.full_name}`,
        createdByPrincipalId: creator.id,
      }, sql);
      const policy = await createPolicyVersion(auth, {
        org_slug: auth.organization.slug,
        slug: `github-${repository.id}`,
        rules: [{
          id: "allow-connector-sync",
          effect: "allow",
          actions: ["connector.sync"],
          resource_types: ["github.repository"],
          principal_ids: [service.id],
          resource_ids: [existingGlobal.id as string],
        }],
      }, sql);
      const managed = await createDelegatedCredential(auth, {
        org_slug: auth.organization.slug,
        principal_id: service.id,
        policy_version_id: policy.id,
        name: `Managed GitHub sync authority: ${repository.full_name}`,
        scopes: ["connector.sync"],
      }, sql);
      replacement = {
        principalId: service.id,
        credentialId: managed.credential.id,
        policyVersionId: policy.id,
      };
    }

    try {
      const results = await sql.transaction([
        sql`
          update connector_sources
          set
            installation_id = ${installationRow.id},
            display_name = ${repository.full_name},
            source_ref = ${sourceRef},
            status = 'active',
            health_status = 'pending',
            service_principal_id = ${replacement?.principalId ?? existingGlobal.service_principal_id},
            managed_credential_id = ${replacement?.credentialId ?? existingGlobal.managed_credential_id},
            policy_version_id = ${replacement?.policyVersionId ?? existingGlobal.policy_version_id},
            generation = generation + 1,
            config = ${JSON.stringify(config)}::jsonb,
            external_acl = ${JSON.stringify(acl)}::jsonb,
            etag = null,
            last_error_code = null,
            updated_at = now()
          where org_id = ${auth.organization.id}
            and id = ${existingGlobal.id}
          returning id
        `,
        sql`
          update connector_sync_runs
          set
            status = 'failed',
            error_code = 'connector_reconfigured',
            finished_at = now(),
            retry_after = now()
          where org_id = ${auth.organization.id}
            and connector_source_id = ${existingGlobal.id}
            and status = 'running'
          returning id
        `,
        sql`
          update brain_sources
          set
            name = ${repository.full_name},
            status = 'active',
            trust_zone = ${config.trust_zone},
            config = ${JSON.stringify(config)}::jsonb,
            metadata = metadata || ${JSON.stringify({
              provider: GITHUB_PROVIDER,
              external_repository_id: String(repository.id),
              repository_node_id: repository.node_id,
            })}::jsonb,
            approved_by_user_id = ${auth.user.id},
            updated_at = now()
          where org_id = ${auth.organization.id}
            and id = (
              select source_id
              from connector_sources
              where org_id = ${auth.organization.id}
                and id = ${existingGlobal.id}
            )
          returning id
        `,
        sql`
          update brain_pages
          set trust_zone = ${config.trust_zone}, updated_at = now()
          where org_id = ${auth.organization.id}
            and source_id = (
              select source_id
              from connector_sources
              where org_id = ${auth.organization.id}
                and id = ${existingGlobal.id}
            )
          returning id
        `,
      ]) as Array<Array<Record<string, unknown>>>;
      if (!results[0]?.[0] || !results[2]?.[0]) {
        throw new GitHubConnectorError("github_connector_update_failed", 500);
      }
    } catch (error) {
      if (replacement) {
        await revokeDelegatedCredential(auth.organization.id, replacement.credentialId, sql).catch(() => null);
      }
      throw error;
    }
    if (replacement) {
      await revokeDelegatedCredential(
        auth.organization.id,
        existingGlobal.managed_credential_id as string,
        sql,
      ).catch(() => null);
    }
    await appendProvenanceEvent({
      orgId: auth.organization.id,
      principalId: creator.id,
      eventType: "connector.updated",
      action: "connector.manage",
      resource: { type: "github.repository", id: existingGlobal.id as string },
      outcome: "success",
      payload: { provider: GITHUB_PROVIDER, trust_zone: config.trust_zone, source_ref: sourceRef },
    }, sql);
    const connector = await getGitHubConnectorById(existingGlobal.id as string, sql);
    if (!connector) throw new GitHubConnectorError("github_connector_not_found", 500);
    return { connector, created: false };
  }

  const connectorId = randomUUID();
  const sourceId = randomUUID();
  const sourceSlug = githubSourceSlug(repository.owner.login, repository.name, repository.id);
  const service = await ensureServicePrincipal({
    orgId: auth.organization.id,
    slug: `github-${repository.id}`,
    name: `GitHub sync: ${repository.full_name}`,
    createdByPrincipalId: creator.id,
  }, sql);
  const policy = await createPolicyVersion(auth, {
    org_slug: auth.organization.slug,
    slug: `github-${repository.id}`,
    rules: [{
      id: "allow-connector-sync",
      effect: "allow",
      actions: ["connector.sync"],
      resource_types: ["github.repository"],
      principal_ids: [service.id],
      resource_ids: [connectorId],
    }],
  }, sql);
  const managed = await createDelegatedCredential(auth, {
    org_slug: auth.organization.slug,
    principal_id: service.id,
    policy_version_id: policy.id,
    name: `Managed GitHub sync authority: ${repository.full_name}`,
    scopes: ["connector.sync"],
  }, sql);

  try {
    const [created] = await sql`
      with inserted_source as (
        insert into brain_sources (
          id,
          org_id,
          slug,
          name,
          kind,
          status,
          trust_zone,
          config,
          metadata,
          created_by_user_id,
          approved_by_user_id
        ) values (
          ${sourceId},
          ${auth.organization.id},
          ${sourceSlug},
          ${repository.full_name},
          ${GITHUB_PROVIDER},
          'active',
          ${config.trust_zone},
          ${JSON.stringify(config)}::jsonb,
          ${JSON.stringify({
            provider: GITHUB_PROVIDER,
            external_repository_id: String(repository.id),
            repository_node_id: repository.node_id,
          })}::jsonb,
          ${auth.user.id},
          ${auth.user.id}
        )
        on conflict (org_id, slug) do nothing
        returning id
      ), inserted_connector as (
        insert into connector_sources (
          id,
          org_id,
          installation_id,
          provider,
          external_resource_id,
          display_name,
          source_id,
          service_principal_id,
          managed_credential_id,
          policy_version_id,
          source_ref,
          status,
          health_status,
          config,
          external_acl
        )
        select
          ${connectorId},
          ${auth.organization.id},
          ${installationRow.id},
          ${GITHUB_PROVIDER},
          ${String(repository.id)},
          ${repository.full_name},
          inserted_source.id,
          ${service.id},
          ${managed.credential.id},
          ${policy.id},
          ${sourceRef},
          'active',
          'pending',
          ${JSON.stringify(config)}::jsonb,
          ${JSON.stringify(acl)}::jsonb
        from inserted_source
        returning id
      )
      select
        (select id from inserted_source) as source_id,
        (select id from inserted_connector) as connector_id
    `;
    if (!created?.source_id) throw new GitHubConnectorError("github_source_slug_conflict", 409);
    if (!created.connector_id) throw new GitHubConnectorError("github_connector_create_failed", 500);
  } catch (error) {
    await revokeDelegatedCredential(auth.organization.id, managed.credential.id, sql).catch(() => null);
    throw error;
  }

  // The managed credential's raw value is intentionally discarded. Only the
  // server may load it through trusted connector foreign keys for webhooks.
  await appendProvenanceEvent({
    orgId: auth.organization.id,
    principalId: creator.id,
    eventType: "connector.registered",
    action: "connector.manage",
    resource: { type: "github.repository", id: connectorId },
    outcome: "success",
    payload: { provider: GITHUB_PROVIDER, trust_zone: config.trust_zone, source_ref: sourceRef },
  }, sql);
  const connector = await getGitHubConnectorById(connectorId, sql);
  if (!connector) throw new GitHubConnectorError("github_connector_not_found", 500);
  return { connector, created: true };
}

export function planGitHubSync(
  treeEntries: GitHubTreeEntry[],
  priorItems: GitHubSyncItem[],
  configInput: Partial<GitHubConnectorConfig>,
): GitHubSyncPlan {
  const selected = selectGitHubTreeEntries(treeEntries, configInput);
  const priorByPath = new Map(priorItems.map((item) => [item.source_path, item]));
  const selectedPaths = new Set(selected.map((item) => item.path));
  const fetch: GitHubTreeEntry[] = [];
  const unchanged: GitHubTreeEntry[] = [];

  for (const item of selected) {
    const prior = priorByPath.get(item.path);
    if (prior?.status === "active" && prior.external_revision === item.sha) unchanged.push(item);
    else fetch.push(item);
  }
  const deleted = priorItems.filter((item) => item.status === "active" && !selectedPaths.has(item.source_path));
  return { selected, fetch, unchanged, deleted };
}

function markdownTitle(path: string, body: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const fallback = basename(path).replace(/\.(?:md|mdx)$/i, "").replace(/[-_]+/g, " ").trim() || "GitHub document";
  return (heading || fallback).slice(0, 180);
}

async function fetchGitHubBlob(input: {
  client: GitHubAppClient;
  token: string;
  owner: string;
  repository: string;
  entry: GitHubTreeEntry;
  maxBytes: number;
}): Promise<{ entry: GitHubTreeEntry; body: string }> {
  const response = await input.client.request(
    input.token,
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/git/blobs/${encodeURIComponent(input.entry.sha)}`,
  );
  const blob = await githubJson<GitHubBlob>(response, "github_blob_read_failed");
  if (blob.sha !== input.entry.sha || blob.encoding !== "base64" || !Number.isSafeInteger(blob.size) || blob.size < 0) {
    throw new GitHubConnectorError("github_blob_invalid", 502);
  }
  const compact = blob.content.replace(/\s/g, "");
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length !== blob.size || bytes.length !== input.entry.size || bytes.length > input.maxBytes) {
    throw new GitHubConnectorError("github_blob_size_mismatch", 502);
  }
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GitHubConnectorError("github_blob_not_utf8", 422);
  }
  if (body.includes("\0")) throw new GitHubConnectorError("github_blob_binary_content", 422);
  if (HIGH_CONFIDENCE_SECRET_PATTERNS.some((pattern) => pattern.test(body))) {
    // Do not identify the file in an error or provenance event. The connector
    // fails the snapshot before any of its fetched bodies are written.
    throw new GitHubConnectorError("github_content_secret_detected", 422);
  }
  return { entry: input.entry, body };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await fn(values[index]!);
    }
  }));
  return output;
}

async function listGitHubSyncItems(connector: GitHubConnectorRecord, sql: Sql): Promise<GitHubSyncItem[]> {
  return (await sql`
    select
      connector_source_items.source_path,
      connector_source_items.external_revision,
      connector_source_items.status,
      connector_source_items.page_id,
      brain_pages.slug as page_slug
    from connector_source_items
    join brain_pages
      on brain_pages.org_id = connector_source_items.org_id
     and brain_pages.id = connector_source_items.page_id
    where connector_source_items.org_id = ${connector.org_id}
      and connector_source_items.connector_source_id = ${connector.id}
    order by connector_source_items.source_path asc
  `) as GitHubSyncItem[];
}

async function upsertGitHubPage(input: {
  connector: GitHubConnectorRecord;
  repository: GitHubRepository;
  runId: string;
  leaseToken: string;
  path: string;
  sha: string;
  size: number;
  body: string;
  cursor: string;
  prior?: GitHubSyncItem;
  sql: Sql;
}): Promise<"created" | "updated"> {
  const pageId = input.prior?.page_id ?? randomUUID();
  const pageSlug = input.prior?.page_slug ?? githubPageSlug(
    input.repository.owner.login,
    input.repository.name,
    input.path,
    input.repository.id,
  );
  if (!input.prior) {
    const [collision] = await input.sql`
      select id, source_id
      from brain_pages
      where org_id = ${input.connector.org_id}
        and slug = ${pageSlug}
      limit 1
    `;
    if (collision) throw new GitHubConnectorError("github_page_slug_conflict", 409);
  }
  const revisionId = randomUUID();
  const frontmatter = {
    connector: GITHUB_PROVIDER,
    connector_source_id: input.connector.id,
    external_repository_id: String(input.repository.id),
    source_path: input.path,
    external_revision: input.sha,
  };
  const [result] = await input.sql`
    with current_connector as (
      select id
      from connector_sources
      where org_id = ${input.connector.org_id}
        and id = ${input.connector.id}
        and status = 'active'
        and generation = ${input.connector.generation}
      for update
    ), current_lease as (
      update connector_sync_runs
      set lease_expires_at = now() + (${SYNC_LEASE_MINUTES} * interval '1 minute')
      where org_id = ${input.connector.org_id}
        and id = ${input.runId}
        and connector_generation = ${input.connector.generation}
        and lease_token = ${input.leaseToken}
        and status = 'running'
        and lease_expires_at > now()
        and exists (select 1 from current_connector)
      returning id
    ), upserted_page as (
      insert into brain_pages (
        id, org_id, source_id, slug, title, status, trust_zone, tags, frontmatter
      )
      select
        ${pageId},
        ${input.connector.org_id},
        ${input.connector.source_id},
        ${pageSlug},
        ${markdownTitle(input.path, input.body)},
        'published',
        ${input.connector.config.trust_zone},
        ${["github", "connector"]}::text[],
        ${JSON.stringify(frontmatter)}::jsonb
      from current_lease
      on conflict (org_id, slug) do update set
        title = excluded.title,
        status = 'published',
        trust_zone = excluded.trust_zone,
        tags = excluded.tags,
        frontmatter = excluded.frontmatter,
        updated_at = now()
      where brain_pages.source_id = excluded.source_id
      returning id
    ), inserted_revision as (
      insert into brain_page_revisions (
        id, org_id, page_id, revision_number, body_md, summary
      )
      select
        ${revisionId},
        ${input.connector.org_id},
        upserted_page.id,
        coalesce((
          select max(revision_number)
          from brain_page_revisions
          where page_id = upserted_page.id
        ), 0) + 1,
        ${input.body},
        ${`Synced from GitHub at ${input.path}`}
      from upserted_page
      returning id, page_id
    ), upserted_item as (
      insert into connector_source_items (
        org_id,
        connector_source_id,
        external_item_id,
        source_path,
        external_revision,
        size_bytes,
        page_id,
        page_revision_id,
        status,
        last_seen_cursor,
        synced_at,
        deleted_at
      )
      select
        ${input.connector.org_id},
        ${input.connector.id},
        ${input.path},
        ${input.path},
        ${input.sha},
        ${input.size},
        inserted_revision.page_id,
        inserted_revision.id,
        'active',
        ${input.cursor},
        now(),
        null
      from inserted_revision
      on conflict (org_id, connector_source_id, external_item_id) do update set
        source_path = excluded.source_path,
        external_revision = excluded.external_revision,
        size_bytes = excluded.size_bytes,
        page_id = excluded.page_id,
        page_revision_id = excluded.page_revision_id,
        status = 'active',
        last_seen_cursor = excluded.last_seen_cursor,
        synced_at = now(),
        deleted_at = null
      returning id
    )
    select
      (select id from current_lease) as lease_id,
      (select id from upserted_page) as page_id,
      (select id from inserted_revision) as revision_id,
      (select id from upserted_item) as item_id
  `;
  if (!result?.lease_id) throw new GitHubConnectorError("connector_sync_lease_lost", 409);
  if (!result.page_id || !result.revision_id || !result.item_id) {
    throw new GitHubConnectorError("github_page_mapping_conflict", 409);
  }
  return input.prior ? "updated" : "created";
}

function connectorErrorCode(error: unknown): string {
  if (error instanceof GitHubApiError) return `github_http_${error.status}`;
  const raw = error instanceof GitHubConnectorError ? error.code : (error as Error)?.message ?? "connector_sync_failed";
  const safe = raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 120);
  return safe || "connector_sync_failed";
}

function retryAfterForError(error: unknown): string {
  if (error instanceof GitHubApiError && error.retryAfter) {
    const seconds = Number(error.retryAfter);
    if (Number.isFinite(seconds)) return new Date(Date.now() + Math.min(Math.max(seconds, 1), 3600) * 1000).toISOString();
    const date = new Date(error.retryAfter);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function assertGovernedSync(input: {
  connector: GitHubConnectorRecord;
  auth: V2CredentialAuthContext;
  receipt: AuthorizationReceipt;
}): void {
  if (
    input.receipt.decision !== "allow" ||
    input.receipt.action !== "connector.sync" ||
    input.receipt.resource.type !== "github.repository" ||
    input.receipt.resource.id !== input.connector.id ||
    input.receipt.org_id !== input.connector.org_id ||
    input.auth.organization.id !== input.connector.org_id ||
    input.receipt.principal.id !== input.auth.principal.id ||
    input.receipt.delegated_credential_id !== input.auth.credential.id
  ) {
    throw new GitHubConnectorError("connector_authorization_invalid", 403);
  }
}

type GitHubSyncCounts = {
  selected: number;
  fetched: number;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
};

async function finalizeGitHubSync(input: {
  connector: GitHubConnectorRecord;
  runId: string;
  leaseToken: string;
  status: "succeeded" | "noop";
  cursor: string | null;
  etag: string | null;
  repository: GitHubRepository;
  counts: GitHubSyncCounts;
  auth: V2CredentialAuthContext;
  receipt: AuthorizationReceipt;
  sql: Sql;
}): Promise<GitHubSyncRun> {
  const eventId = randomUUID();
  const eventPayload = {
    status: input.status,
    selected_count: input.counts.selected,
    fetched_count: input.counts.fetched,
    created_count: input.counts.created,
    updated_count: input.counts.updated,
    deleted_count: input.counts.deleted,
    unchanged_count: input.counts.unchanged,
  };
  const [finished] = await input.sql`
    with current_connector as (
      select id
      from connector_sources
      where org_id = ${input.connector.org_id}
        and id = ${input.connector.id}
        and status = 'active'
        and generation = ${input.connector.generation}
      for update
    ), finished_run as (
      update connector_sync_runs
      set
        status = ${input.status},
        cursor_to = ${input.cursor},
        selected_count = ${input.counts.selected},
        fetched_count = ${input.counts.fetched},
        created_count = ${input.counts.created},
        updated_count = ${input.counts.updated},
        deleted_count = ${input.counts.deleted},
        unchanged_count = ${input.counts.unchanged},
        snapshot_authoritative = true,
        deletion_applied = true,
        error_code = null,
        finished_at = now(),
        retry_after = null
      where org_id = ${input.connector.org_id}
        and id = ${input.runId}
        and connector_generation = ${input.connector.generation}
        and lease_token = ${input.leaseToken}
        and status = 'running'
        and lease_expires_at > now()
        and exists (select 1 from current_connector)
      returning *
    ), updated_connector as (
      update connector_sources
      set
        display_name = ${input.repository.full_name},
        health_status = 'healthy',
        sync_cursor = ${input.cursor},
        etag = ${input.etag},
        last_success_at = now(),
        last_error_code = null,
        external_acl = external_acl || ${JSON.stringify({
          repository_private: input.repository.private,
          repository_visibility: input.repository.visibility,
          repository_owner_id: String(input.repository.owner.id),
        })}::jsonb,
        updated_at = now()
      where org_id = ${input.connector.org_id}
        and id = ${input.connector.id}
        and exists (select 1 from finished_run)
      returning id
    ), updated_brain_source as (
      update brain_sources
      set
        name = ${input.repository.full_name},
        trust_zone = ${input.connector.config.trust_zone},
        updated_at = now()
      where org_id = ${input.connector.org_id}
        and id = ${input.connector.source_id}
        and exists (select 1 from finished_run)
      returning id
    ), updated_pages as (
      update brain_pages
      set trust_zone = ${input.connector.config.trust_zone}, updated_at = now()
      where org_id = ${input.connector.org_id}
        and source_id = ${input.connector.source_id}
        and exists (select 1 from finished_run)
      returning id
    ), inserted_event as (
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
      )
      select
        ${eventId},
        ${input.connector.org_id},
        ${input.auth.principal.id},
        ${input.auth.credential.id},
        'connector.sync.completed',
        'connector.sync',
        'github.repository',
        ${input.connector.id},
        'success',
        ${input.receipt.id},
        ${input.receipt.correlation_id},
        ${JSON.stringify(eventPayload)}::jsonb
      from finished_run
      returning id
    )
    select finished_run.*
    from finished_run
  `;
  if (!finished) throw new GitHubConnectorError("connector_sync_lease_lost", 409);
  return finished as GitHubSyncRun;
}

async function failGitHubSync(input: {
  connector: GitHubConnectorRecord;
  runId: string;
  leaseToken: string;
  code: string;
  retryAfter: string;
  auth: V2CredentialAuthContext;
  receipt: AuthorizationReceipt;
  sql: Sql;
}): Promise<boolean> {
  const eventId = randomUUID();
  const [failed] = await input.sql`
    with failed_run as (
      update connector_sync_runs
      set
        status = 'failed',
        error_code = ${input.code},
        finished_at = now(),
        retry_after = ${input.retryAfter}
      where org_id = ${input.connector.org_id}
        and id = ${input.runId}
        and connector_generation = ${input.connector.generation}
        and lease_token = ${input.leaseToken}
        and status = 'running'
      returning id
    ), updated_connector as (
      update connector_sources
      set health_status = 'degraded', last_error_code = ${input.code}, updated_at = now()
      where org_id = ${input.connector.org_id}
        and id = ${input.connector.id}
        and status = 'active'
        and generation = ${input.connector.generation}
        and exists (select 1 from failed_run)
      returning id
    ), inserted_event as (
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
      )
      select
        ${eventId},
        ${input.connector.org_id},
        ${input.auth.principal.id},
        ${input.auth.credential.id},
        'connector.sync.failed',
        'connector.sync',
        'github.repository',
        ${input.connector.id},
        'failure',
        ${input.receipt.id},
        ${input.receipt.correlation_id},
        ${JSON.stringify({ error_code: input.code, retry_scheduled: true })}::jsonb
      from failed_run
      returning id
    )
    select id from failed_run
  `;
  return Boolean(failed);
}

export async function syncGitHubConnector(input: {
  connectorId: string;
  auth: V2CredentialAuthContext;
  receipt: AuthorizationReceipt;
  triggerKind: GitHubSyncRun["trigger_kind"];
  idempotencyKey: string;
  client?: GitHubAppClient;
  sql?: Sql;
}): Promise<GitHubSyncRun> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(input.idempotencyKey)) {
    throw new GitHubConnectorError("idempotency_key_invalid");
  }
  const sql = input.sql ?? getSql();
  const connector = await getGitHubConnectorById(input.connectorId, sql);
  if (!connector) throw new GitHubConnectorError("github_connector_not_found", 404);
  assertGovernedSync({ connector, auth: input.auth, receipt: input.receipt });
  if (connector.status !== "active" || connector.installation_status !== "active") {
    throw new GitHubConnectorError("github_connector_inactive", 409);
  }
  const configDigest = githubConnectorConfigDigest(
    connector.config,
    connector.source_ref,
    connector.generation,
  );

  // A crashed serverless invocation must not hold the partial unique lease
  // forever. Reclaim only after its persisted lease has expired.
  await sql`
    update connector_sync_runs
    set
      status = 'failed',
      error_code = 'sync_lease_expired',
      finished_at = now(),
      retry_after = now()
    where org_id = ${connector.org_id}
      and connector_source_id = ${connector.id}
      and status = 'running'
      and lease_expires_at <= now()
  `;

  const [existing] = await sql`
    select *
    from connector_sync_runs
    where org_id = ${connector.org_id}
      and connector_source_id = ${connector.id}
      and idempotency_key = ${input.idempotencyKey}
    limit 1
  `;
  let run: GitHubSyncRun | null = null;
  if (existing) {
    if (existing.config_digest !== configDigest) {
      throw new GitHubConnectorError("idempotency_config_conflict", 409);
    }
    if (existing.status !== "failed") return existing as GitHubSyncRun;
    const retryLeaseToken = randomUUID();
    const [retried] = await sql`
      update connector_sync_runs
      set
        trigger_kind = 'retry',
        status = 'running',
        attempt_number = attempt_number + 1,
        correlation_id = ${input.receipt.correlation_id},
        authorization_receipt_id = ${input.receipt.id},
        lease_token = ${retryLeaseToken},
        lease_expires_at = now() + (${SYNC_LEASE_MINUTES} * interval '1 minute'),
        snapshot_authoritative = false,
        deletion_applied = false,
        cursor_from = ${connector.sync_cursor},
        cursor_to = null,
        selected_count = 0,
        fetched_count = 0,
        created_count = 0,
        updated_count = 0,
        deleted_count = 0,
        unchanged_count = 0,
        error_code = null,
        started_at = now(),
        finished_at = null,
        retry_after = null
      where org_id = ${connector.org_id}
        and id = ${existing.id}
        and status = 'failed'
        and (retry_after is null or retry_after <= now())
      returning *
    `;
    if (!retried) throw new GitHubConnectorError("connector_retry_not_ready", 409);
    run = retried as GitHubSyncRun;
  }

  if (!run) try {
    const runId = randomUUID();
    const leaseToken = randomUUID();
    const [created] = await sql`
      insert into connector_sync_runs (
        id,
        org_id,
        connector_source_id,
        trigger_kind,
        status,
        idempotency_key,
        correlation_id,
        authorization_receipt_id,
        config_digest,
        connector_generation,
        lease_token,
        lease_expires_at,
        cursor_from
      ) values (
        ${runId},
        ${connector.org_id},
        ${connector.id},
        ${input.triggerKind},
        'running',
        ${input.idempotencyKey},
        ${input.receipt.correlation_id},
        ${input.receipt.id},
        ${configDigest},
        ${connector.generation},
        ${leaseToken},
        now() + (${SYNC_LEASE_MINUTES} * interval '1 minute'),
        ${connector.sync_cursor}
      )
      returning *
    `;
    run = created as GitHubSyncRun;
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    const [duplicate] = await sql`
      select *
      from connector_sync_runs
      where org_id = ${connector.org_id}
        and connector_source_id = ${connector.id}
        and idempotency_key = ${input.idempotencyKey}
      limit 1
    `;
    if (duplicate) return duplicate as GitHubSyncRun;
    throw new GitHubConnectorError("connector_sync_in_progress", 409);
  }
  if (!run) throw new GitHubConnectorError("connector_sync_create_failed", 500);
  const leaseToken = run.lease_token;
  if (!leaseToken) throw new GitHubConnectorError("connector_sync_lease_invalid", 500);

  const client = input.client ?? githubAppClientFromEnvironment();
  const [attempted] = await sql`
    with current_connector as (
      select id
      from connector_sources
      where org_id = ${connector.org_id}
        and id = ${connector.id}
        and status = 'active'
        and generation = ${connector.generation}
      for update
    ), current_lease as (
      update connector_sync_runs
      set lease_expires_at = now() + (${SYNC_LEASE_MINUTES} * interval '1 minute')
      where org_id = ${connector.org_id}
        and id = ${run.id}
        and connector_generation = ${connector.generation}
        and lease_token = ${leaseToken}
        and status = 'running'
        and lease_expires_at > now()
        and exists (select 1 from current_connector)
      returning id
    )
    update connector_sources
    set last_attempt_at = now(), updated_at = now()
    where org_id = ${connector.org_id}
      and id = ${connector.id}
      and exists (select 1 from current_lease)
    returning id
  `;
  if (!attempted) throw new GitHubConnectorError("connector_sync_lease_lost", 409);

  try {
    const installationId = parsePositiveExternalId(connector.external_installation_id, "github_installation_id_invalid");
    const repositoryId = parsePositiveExternalId(connector.external_resource_id, "github_repository_id_invalid");
    const access = await client.createInstallationToken({
      installationId,
      repositoryIds: [repositoryId],
      permissions: { contents: "read" },
    });
    const repository = await githubJson<GitHubRepository>(
      await client.request(access.token, `/repositories/${repositoryId}`),
      "github_repository_read_failed",
    );
    if (repository.id !== repositoryId || repository.disabled) {
      throw new GitHubConnectorError("github_repository_identity_mismatch", 502);
    }
    const treeResponse = await client.request(
      access.token,
      `/repos/${encodeURIComponent(repository.owner.login)}/${encodeURIComponent(repository.name)}/git/trees/${encodeURIComponent(connector.source_ref)}?recursive=1`,
      {},
      connector.etag,
    );
    if (treeResponse.status === 304) {
      return finalizeGitHubSync({
        connector,
        runId: run.id,
        leaseToken,
        status: "noop",
        cursor: connector.sync_cursor,
        etag: connector.etag,
        repository,
        counts: { selected: 0, fetched: 0, created: 0, updated: 0, deleted: 0, unchanged: 0 },
        auth: input.auth,
        receipt: input.receipt,
        sql,
      });
    }
    const tree = await githubJson<GitHubTree>(treeResponse, "github_tree_read_failed");
    if (!tree.sha || !Array.isArray(tree.tree)) throw new GitHubConnectorError("github_tree_invalid", 502);
    if (tree.truncated) throw new GitHubConnectorError("github_tree_truncated", 422);

    const priorItems = await listGitHubSyncItems(connector, sql);
    const priorByPath = new Map(priorItems.map((item) => [item.source_path, item]));
    const plan = planGitHubSync(tree.tree, priorItems, connector.config);
    const totalSelectedBytes = plan.selected.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
    if (totalSelectedBytes > MAX_SYNC_BYTES) throw new GitHubConnectorError("github_sync_byte_limit_exceeded", 422);
    const [snapshotReady] = await sql`
      with current_connector as (
        select id
        from connector_sources
        where org_id = ${connector.org_id}
          and id = ${connector.id}
          and status = 'active'
          and generation = ${connector.generation}
        for update
      )
      update connector_sync_runs
      set
        snapshot_authoritative = true,
        lease_expires_at = now() + (${SYNC_LEASE_MINUTES} * interval '1 minute')
      where org_id = ${connector.org_id}
        and id = ${run.id}
        and connector_generation = ${connector.generation}
        and lease_token = ${leaseToken}
        and status = 'running'
        and lease_expires_at > now()
        and exists (select 1 from current_connector)
      returning id
    `;
    if (!snapshotReady) throw new GitHubConnectorError("connector_sync_lease_lost", 409);
    const blobs = await mapWithConcurrency(plan.fetch, 4, (entry) => fetchGitHubBlob({
      client,
      token: access.token,
      owner: repository.owner.login,
      repository: repository.name,
      entry,
      maxBytes: connector.config.max_file_bytes,
    }));

    let createdCount = 0;
    let updatedCount = 0;
    for (const blob of blobs) {
      const result = await upsertGitHubPage({
        connector,
        repository,
        runId: run.id,
        leaseToken,
        path: blob.entry.path,
        sha: blob.entry.sha,
        size: blob.entry.size!,
        body: blob.body,
        cursor: tree.sha,
        prior: priorByPath.get(blob.entry.path),
        sql,
      });
      if (result === "created") createdCount += 1;
      else updatedCount += 1;
    }

    if (plan.unchanged.length > 0) {
      const [marked] = await sql`
        with current_connector as (
          select id
          from connector_sources
          where org_id = ${connector.org_id}
            and id = ${connector.id}
            and status = 'active'
            and generation = ${connector.generation}
          for update
        ), current_lease as (
          update connector_sync_runs
          set lease_expires_at = now() + (${SYNC_LEASE_MINUTES} * interval '1 minute')
          where org_id = ${connector.org_id}
            and id = ${run.id}
            and connector_generation = ${connector.generation}
            and lease_token = ${leaseToken}
            and status = 'running'
            and lease_expires_at > now()
            and exists (select 1 from current_connector)
          returning id
        ), updated_items as (
          update connector_source_items
          set last_seen_cursor = ${tree.sha}, synced_at = now()
          where org_id = ${connector.org_id}
            and connector_source_id = ${connector.id}
            and source_path = any(${plan.unchanged.map((item) => item.path)}::text[])
            and status = 'active'
            and exists (select 1 from current_lease)
          returning id
        )
        select (select id from current_lease) as lease_id
      `;
      if (!marked?.lease_id) throw new GitHubConnectorError("connector_sync_lease_lost", 409);
    }
    let deletedCount = 0;
    if (plan.deleted.length > 0) {
      const deletedPaths = plan.deleted.map((item) => item.source_path);
      const [deleted] = await sql`
        with current_connector as (
          select id
          from connector_sources
          where org_id = ${connector.org_id}
            and id = ${connector.id}
            and status = 'active'
            and generation = ${connector.generation}
          for update
        ), current_lease as (
          update connector_sync_runs
          set lease_expires_at = now() + (${SYNC_LEASE_MINUTES} * interval '1 minute')
          where org_id = ${connector.org_id}
            and id = ${run.id}
            and connector_generation = ${connector.generation}
            and lease_token = ${leaseToken}
            and status = 'running'
            and lease_expires_at > now()
            and exists (select 1 from current_connector)
          returning id
        ), deleted_items as (
          update connector_source_items
          set status = 'deleted', deleted_at = now(), synced_at = now(), last_seen_cursor = ${tree.sha}
          where org_id = ${connector.org_id}
            and connector_source_id = ${connector.id}
            and source_path = any(${deletedPaths}::text[])
            and status = 'active'
            and exists (select 1 from current_lease)
          returning page_id
        ), archived_pages as (
          update brain_pages
          set status = 'archived', updated_at = now()
          where org_id = ${connector.org_id}
            and source_id = ${connector.source_id}
            and id in (select page_id from deleted_items)
          returning id
        )
        select
          (select id from current_lease) as lease_id,
          (select count(*)::int from deleted_items) as deleted_count
      `;
      if (!deleted?.lease_id) throw new GitHubConnectorError("connector_sync_lease_lost", 409);
      deletedCount = Number(deleted.deleted_count ?? 0);
    }

    const status = blobs.length === 0 && deletedCount === 0 ? "noop" : "succeeded";
    const etag = treeResponse.headers.get("etag");
    return finalizeGitHubSync({
      connector,
      runId: run.id,
      leaseToken,
      status,
      cursor: tree.sha,
      etag,
      repository,
      counts: {
        selected: plan.selected.length,
        fetched: blobs.length,
        created: createdCount,
        updated: updatedCount,
        deleted: deletedCount,
        unchanged: plan.unchanged.length,
      },
      auth: input.auth,
      receipt: input.receipt,
      sql,
    });
  } catch (error) {
    const code = connectorErrorCode(error);
    const retryAfter = retryAfterForError(error);
    await failGitHubSync({
      connector,
      runId: run.id,
      leaseToken,
      code,
      retryAfter,
      auth: input.auth,
      receipt: input.receipt,
      sql,
    }).catch(() => false);
    throw error instanceof GitHubConnectorError || error instanceof GitHubApiError
      ? error
      : new GitHubConnectorError(code, 502);
  }
}

export async function listGitHubSyncRuns(
  orgId: string,
  connectorId: string,
  sqlOverride?: Sql,
): Promise<GitHubSyncRun[]> {
  const sql = sqlOverride ?? getSql();
  return (await sql`
    select *
    from connector_sync_runs
    where org_id = ${orgId}
      and connector_source_id = ${connectorId}
    order by started_at desc
    limit 50
  `) as GitHubSyncRun[];
}

/**
 * Webhooks and initial setup use only the service identity persisted on the
 * tenant-bound connector row. No raw credential is retained or accepted.
 */
export async function syncGitHubConnectorWithManagedAuthority(input: {
  connectorId: string;
  triggerKind: GitHubSyncRun["trigger_kind"];
  idempotencyKey: string;
  requestId?: string;
  correlationId?: string;
  req?: Request;
  client?: GitHubAppClient;
  sql?: Sql;
}): Promise<{ authorization_receipt: AuthorizationReceipt; sync_run: GitHubSyncRun | null }> {
  const sql = input.sql ?? getSql();
  const connector = await getGitHubConnectorById(input.connectorId, sql);
  if (!connector) throw new GitHubConnectorError("github_connector_not_found", 404);
  const auth = await loadInternalV2CredentialAuth({
    orgId: connector.org_id,
    credentialId: connector.managed_credential_id,
    principalId: connector.service_principal_id,
  }, sql);
  if (!auth) throw new GitHubConnectorError("connector_managed_authority_inactive", 409);
  const receipt = await authorizeAndRecordV2Action({
    auth,
    action: "connector.sync",
    resource: { orgId: connector.org_id, type: "github.repository", id: connector.id },
    requestId: input.requestId,
    correlationId: input.correlationId,
    req: input.req,
  }, sql);
  if (receipt.decision !== "allow") return { authorization_receipt: receipt, sync_run: null };
  const run = await syncGitHubConnector({
    connectorId: connector.id,
    auth,
    receipt,
    triggerKind: input.triggerKind,
    idempotencyKey: input.idempotencyKey,
    client: input.client,
    sql,
  });
  return { authorization_receipt: receipt, sync_run: run };
}

export async function revokeGitHubConnector(
  auth: HumanOrgContext,
  connectorId: string,
  sqlOverride?: Sql,
): Promise<boolean> {
  const sql = sqlOverride ?? getSql();
  const connector = await getGitHubConnectorById(connectorId, sql);
  if (!connector || connector.org_id !== auth.organization.id) return false;
  const principal = await ensureHumanPrincipal(auth, sql);
  const results = await sql.transaction([
    sql`
      update connector_sources
      set
        status = 'revoked',
        health_status = 'revoked',
        generation = generation + 1,
        last_error_code = 'connector_revoked',
        updated_at = now()
      where org_id = ${connector.org_id} and id = ${connector.id}
      returning id
    `,
    sql`
      update connector_sync_runs
      set
        status = 'failed',
        error_code = 'connector_revoked',
        finished_at = now(),
        retry_after = null
      where org_id = ${connector.org_id}
        and connector_source_id = ${connector.id}
        and status = 'running'
      returning id
    `,
    sql`
      update brain_sources
      set status = 'disabled', updated_at = now()
      where org_id = ${connector.org_id} and id = ${connector.source_id}
    `,
    sql`
      update brain_pages
      set status = 'archived', updated_at = now()
      where org_id = ${connector.org_id}
        and source_id = ${connector.source_id}
        and status <> 'archived'
      returning id
    `,
    sql`
      update connector_source_items
      set status = 'deleted', deleted_at = coalesce(deleted_at, now()), synced_at = now()
      where org_id = ${connector.org_id}
        and connector_source_id = ${connector.id}
        and status = 'active'
    `,
    sql`
      update delegated_credentials
      set status = 'revoked', revoked_at = coalesce(revoked_at, now())
      where org_id = ${connector.org_id}
        and id = ${connector.managed_credential_id}
        and status = 'active'
    `,
  ]) as Array<Array<Record<string, unknown>>>;
  const archivedPageCount = results[3]?.length ?? 0;
  await appendProvenanceEvent({
    orgId: connector.org_id,
    principalId: principal.id,
    eventType: "connector.revoked",
    action: "connector.manage",
    resource: { type: "github.repository", id: connector.id },
    outcome: "success",
    payload: { provider: GITHUB_PROVIDER, archived_page_count: archivedPageCount },
  }, sql);
  return true;
}

export async function revokeGitHubConnectorFromProvider(
  connectorId: string,
  reason: "installation_revoked" | "repository_removed" | "repository_deleted",
  sqlOverride?: Sql,
): Promise<boolean> {
  const sql = sqlOverride ?? getSql();
  const connector = await getGitHubConnectorById(connectorId, sql);
  if (!connector) return false;
  const results = await sql.transaction([
    sql`
      update connector_sources
      set
        status = 'revoked',
        health_status = 'revoked',
        generation = generation + 1,
        last_error_code = ${reason},
        updated_at = now()
      where org_id = ${connector.org_id} and id = ${connector.id}
      returning id
    `,
    sql`
      update connector_sync_runs
      set
        status = 'failed',
        error_code = ${reason},
        finished_at = now(),
        retry_after = null
      where org_id = ${connector.org_id}
        and connector_source_id = ${connector.id}
        and status = 'running'
      returning id
    `,
    sql`
      update brain_sources
      set status = 'disabled', updated_at = now()
      where org_id = ${connector.org_id} and id = ${connector.source_id}
    `,
    sql`
      update brain_pages
      set status = 'archived', updated_at = now()
      where org_id = ${connector.org_id}
        and source_id = ${connector.source_id}
        and status <> 'archived'
      returning id
    `,
    sql`
      update connector_source_items
      set status = 'deleted', deleted_at = coalesce(deleted_at, now()), synced_at = now()
      where org_id = ${connector.org_id}
        and connector_source_id = ${connector.id}
        and status = 'active'
    `,
    sql`
      update delegated_credentials
      set status = 'revoked', revoked_at = coalesce(revoked_at, now())
      where org_id = ${connector.org_id}
        and id = ${connector.managed_credential_id}
        and status = 'active'
    `,
  ]) as Array<Array<Record<string, unknown>>>;
  const archivedPageCount = results[3]?.length ?? 0;
  await appendProvenanceEvent({
    orgId: connector.org_id,
    principalId: connector.service_principal_id,
    delegatedCredentialId: connector.managed_credential_id,
    eventType: "connector.revoked",
    action: "connector.manage",
    resource: { type: "github.repository", id: connector.id },
    outcome: "success",
    payload: { provider: GITHUB_PROVIDER, reason, archived_page_count: archivedPageCount },
  }, sql);
  return true;
}

export function webhookBodyWithinLimit(body: string): boolean {
  return Buffer.byteLength(body, "utf8") <= MAX_WEBHOOK_BYTES;
}

export function webhookPayloadDigest(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
