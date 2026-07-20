#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveAlias(specifier) {
  const base = path.join(rootDir, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${base}.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(resolveAlias(specifier)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  completeGitHubSetupOwnershipVerification,
  githubConnectorConfigDigest,
  planGitHubSync,
  registerGitHubConnector,
  syncGitHubConnector,
  webhookBodyWithinLimit,
  webhookPayloadDigest,
} = await import("../../lib/core/github-connector.ts");
const { claimGitHubWebhook } = await import("../../lib/core/github-webhook.ts");
const { githubConnectorBetaEnabledFor } = await import("../../lib/core/github-beta.ts");
const { normalizeGitHubConnectorConfig } = await import("../../lib/core/github-connector-contract.ts");

const connectorSource = await readFile(path.join(rootDir, "lib/core/github-connector.ts"), "utf8");

function sourceSection(start, end) {
  const from = connectorSource.indexOf(start);
  assert.notEqual(from, -1, `missing source marker: ${start}`);
  const to = connectorSource.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing source marker: ${end}`);
  return connectorSource.slice(from, to).replace(/\s+/g, " ");
}

test("GitHub private beta access is an explicit fail-closed organization allowlist", () => {
  const organization = {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "acme",
  };
  assert.equal(githubConnectorBetaEnabledFor(organization, undefined), false);
  assert.equal(githubConnectorBetaEnabledFor(organization, ""), false);
  assert.equal(githubConnectorBetaEnabledFor(organization, "other"), false);
  assert.equal(githubConnectorBetaEnabledFor(organization, "other, ACME "), true);
  assert.equal(githubConnectorBetaEnabledFor(organization, organization.id.toUpperCase()), true);
});

test("GitHub setup, registration, and manual sync routes enforce the beta gate", async () => {
  for (const relativePath of [
    "app/api/v2/connectors/github/setup/route.ts",
    "app/api/v2/connectors/github/setup/callback/route.ts",
    "app/api/v2/connectors/github/setup/verify/route.ts",
    "app/api/v2/connectors/github/repositories/route.ts",
    "app/api/v2/connectors/github/repositories/[id]/sync/route.ts",
  ]) {
    const routeSource = await readFile(path.join(rootDir, relativePath), "utf8");
    assert.match(routeSource, /assertGitHubConnectorBetaAccess\(/, relativePath);
  }

  const inspectAndRevokeRoute = await readFile(
    path.join(rootDir, "app/api/v2/connectors/github/repositories/[id]/route.ts"),
    "utf8",
  );
  assert.doesNotMatch(inspectAndRevokeRoute, /assertGitHubConnectorBetaAccess/);
});

test("connector schema pins tenant, provider, revision, setup-state, and lease invariants", async () => {
  const migration = await readFile(path.join(rootDir, "db/029_governed_connectors.sql"), "utf8");
  for (const required of [
    "foreign key (org_id, installation_id, provider)",
    "references connector_installations(org_id, id, provider)",
    "page_revision_id",
    "references brain_page_revisions(org_id, id)",
    "unique (org_id, connector_source_id, page_id)",
    "connector_source_id is null or org_id is not null",
    "connector_setup_states",
    "config_digest",
    "connector_generation",
    "lease_token",
    "lease_expires_at",
    "snapshot_authoritative",
    "deletion_applied",
  ]) {
    assert.equal(migration.includes(required), true, required);
  }
});

test("repository registration requires a setup-bound installation before any GitHub call", async () => {
  let githubCalls = 0;
  const sql = async () => [];
  const auth = {
    user: { id: "00000000-0000-4000-8000-000000000010", email: "owner@example.test" },
    membership: { role: "owner" },
    organization: {
      id: "00000000-0000-4000-8000-000000000001",
      slug: "acme",
      name: "Acme",
      status: "active",
    },
  };
  const client = {
    createInstallationToken: async () => {
      githubCalls += 1;
      throw new Error("GitHub must not be called before setup binding");
    },
  };

  await assert.rejects(
    registerGitHubConnector(
      auth,
      { installation_id: 42, repository_id: 7 },
      { client, sql },
    ),
    /github_setup_required/,
  );
  assert.equal(githubCalls, 0);

  const registration = sourceSection(
    "export async function registerGitHubConnector",
    "async function fetchGitHubBlob",
  );
  assert.ok(registration.indexOf("from connector_installations") < registration.indexOf("verifyInstallationRepository"));
  assert.match(registration, /external_installation_id = \$\{String\(input\.installation_id\)\}/);
});

test("sync mutations and terminal transitions are fenced by a rotating lease token", () => {
  const upsert = sourceSection("async function upsertGitHubPage", "function connectorErrorCode");
  const finalize = sourceSection("async function finalizeGitHubSync", "async function failGitHubSync");
  const failure = sourceSection("async function failGitHubSync", "export async function syncGitHubConnector");
  const sync = sourceSection("export async function syncGitHubConnector", "export async function listGitHubSyncRuns");

  assert.match(upsert, /lease_token = \$\{input\.leaseToken\}.*status = 'running'.*lease_expires_at > now\(\)/);
  assert.match(finalize, /lease_token = \$\{input\.leaseToken\}.*status = 'running'.*lease_expires_at > now\(\)/);
  assert.match(failure, /lease_token = \$\{input\.leaseToken\}.*status = 'running'/);
  assert.match(sync, /const retryLeaseToken = randomUUID\(\).*lease_token = \$\{retryLeaseToken\}/);
  assert.match(sync, /const leaseToken = randomUUID\(\).*lease_token, lease_expires_at.*\$\{leaseToken\}/);

  // Initial attempt, snapshot acceptance, unchanged-item writes, and deletion
  // writes must all either establish or present the same per-attempt token.
  assert.ok((sync.match(/lease_token = \$\{leaseToken\}/g) ?? []).length >= 3);
  assert.match(sync, /current_lease as \( update connector_sync_runs.*updated_items as \( update connector_source_items/s);
  assert.match(sync, /current_lease as \( update connector_sync_runs.*deleted_items as \( update connector_source_items.*archived_pages as \( update brain_pages/s);
  assert.match(upsert, /current_connector as \( select id from connector_sources.*for update.*connector_generation = \$\{input\.connector\.generation\}/s);
  assert.match(finalize, /current_connector as \( select id from connector_sources.*for update.*connector_generation = \$\{input\.connector\.generation\}/s);
});

test("completion and failure provenance are atomic with their fenced run transition", () => {
  const finalize = sourceSection("async function finalizeGitHubSync", "async function failGitHubSync");
  const failure = sourceSection("async function failGitHubSync", "export async function syncGitHubConnector");

  assert.match(finalize, /finished_run as \( update connector_sync_runs/);
  assert.match(finalize, /inserted_event as \( insert into provenance_events/);
  assert.match(finalize, /from finished_run returning id/);
  assert.doesNotMatch(finalize, /appendProvenanceEvent/);

  assert.match(failure, /with failed_run as \( update connector_sync_runs/);
  assert.match(failure, /inserted_event as \( insert into provenance_events/);
  assert.match(failure, /from failed_run returning id/);
  assert.doesNotMatch(failure, /appendProvenanceEvent/);
});

test("trust-zone changes propagate to every existing page on update and successful sync", () => {
  const registration = sourceSection(
    "export async function registerGitHubConnector",
    "async function fetchGitHubBlob",
  );
  const finalize = sourceSection("async function finalizeGitHubSync", "async function failGitHubSync");

  assert.match(registration, /update brain_pages set trust_zone = \$\{config\.trust_zone\}/);
  assert.match(registration, /source_id = \( select source_id from connector_sources/);
  assert.match(finalize, /updated_pages as \( update brain_pages set trust_zone = \$\{input\.connector\.config\.trust_zone\}/);
  assert.match(finalize, /source_id = \$\{input\.connector\.source_id\}.*exists \(select 1 from finished_run\)/);
});

test("reconnecting revoked authority provisions and atomically installs a replacement", () => {
  const registration = sourceSection(
    "export async function registerGitHubConnector",
    "async function fetchGitHubBlob",
  );

  assert.match(registration, /loadInternalV2CredentialAuth/);
  assert.match(registration, /catch \{ authorityReady = false; \}/);
  assert.match(registration, /if \(!authorityReady\).*github-\$\{repository\.id\}-reconnect-\$\{reconnectSuffix\}/);
  assert.match(registration, /ensureServicePrincipal.*createPolicyVersion.*createDelegatedCredential/);
  assert.match(registration, /service_principal_id = \$\{replacement\?\.principalId \?\? existingGlobal\.service_principal_id\}/);
  assert.match(registration, /managed_credential_id = \$\{replacement\?\.credentialId \?\? existingGlobal\.managed_credential_id\}/);
  assert.match(registration, /policy_version_id = \$\{replacement\?\.policyVersionId \?\? existingGlobal\.policy_version_id\}/);
  assert.match(registration, /if \(replacement\).*revokeDelegatedCredential/s);
});

test("incremental plans fetch only changed paths and delete only from a complete selected snapshot", () => {
  const config = normalizeGitHubConnectorConfig({});
  const prior = [
    { source_path: "README.md", external_revision: "same", status: "active", page_id: "p1", page_slug: "readme" },
    { source_path: "docs/changed.md", external_revision: "old", status: "active", page_id: "p2", page_slug: "changed" },
    { source_path: "docs/removed.md", external_revision: "gone", status: "active", page_id: "p3", page_slug: "removed" },
    { source_path: "docs/restored.md", external_revision: "past", status: "deleted", page_id: "p4", page_slug: "restored" },
  ];
  const tree = [
    { path: "docs/restored.md", mode: "100644", type: "blob", sha: "back", size: 10 },
    { path: "README.md", mode: "100644", type: "blob", sha: "same", size: 10 },
    { path: "docs/changed.md", mode: "100644", type: "blob", sha: "new", size: 10 },
  ];
  const plan = planGitHubSync(tree, prior, config);
  assert.deepEqual(plan.selected.map((entry) => entry.path), ["README.md", "docs/changed.md", "docs/restored.md"]);
  assert.deepEqual(plan.unchanged.map((entry) => entry.path), ["README.md"]);
  assert.deepEqual(plan.fetch.map((entry) => entry.path), ["docs/changed.md", "docs/restored.md"]);
  assert.deepEqual(plan.deleted.map((entry) => entry.source_path), ["docs/removed.md"]);
});

test("sync idempotency includes the normalized connector configuration", () => {
  const red = normalizeGitHubConnectorConfig({ trust_zone: "red" });
  const green = normalizeGitHubConnectorConfig({ trust_zone: "green" });
  assert.equal(githubConnectorConfigDigest(red), githubConnectorConfigDigest({ ...red }));
  assert.notEqual(githubConnectorConfigDigest(red), githubConnectorConfigDigest(green));
  assert.notEqual(githubConnectorConfigDigest(red, "main", 1), githubConnectorConfigDigest(red, "release", 1));
  assert.notEqual(githubConnectorConfigDigest(red, "main", 1), githubConnectorConfigDigest(red, "main", 2));
});

test("setup binds only repositories visible to a one-time GitHub App user token", () => {
  const setup = sourceSection(
    "export async function beginGitHubSetupOwnershipVerification",
    "function parsePositiveExternalId",
  );
  const registration = sourceSection(
    "export async function registerGitHubConnector",
    "async function fetchGitHubBlob",
  );

  assert.match(setup, /github\.com\/login\/oauth\/authorize/);
  assert.match(setup, /\/user\/installations\/\$\{installationId\}\/repositories/);
  assert.match(setup, /verified_repository_ids/);
  assert.match(setup, /revokeOneTimeGitHubUserToken/);
  assert.match(registration, /verifiedRepositoryIds\.includes\(String\(input\.repository_id\)\)/);
  assert.match(registration, /github_repository_user_access_denied/);
});

function setupVerificationSql() {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim();
    calls.push({ query, values });
    if (query.startsWith("select id, external_installation_id from connector_setup_states")) {
      return [{ id: "90000000-0000-4000-8000-000000000001", external_installation_id: "42" }];
    }
    if (query.startsWith("insert into control_principals")) {
      return [{
        id: "10000000-0000-4000-8000-000000000010",
        org_id: "00000000-0000-4000-8000-000000000001",
        principal_type: "human",
        slug: "human-owner",
        name: "Owner",
        status: "active",
      }];
    }
    if (query.startsWith("with consumed_state as")) {
      return [{
        state_id: "90000000-0000-4000-8000-000000000001",
        installation_id: "50000000-0000-4000-8000-000000000001",
      }];
    }
    throw new Error(`unexpected setup SQL: ${query}`);
  };
  return { sql, calls };
}

test("setup ownership verification binds an accessible repository and revokes the one-time user token", async () => {
  const previousClientId = process.env.FREGE_GITHUB_APP_CLIENT_ID;
  const previousClientSecret = process.env.FREGE_GITHUB_APP_CLIENT_SECRET;
  process.env.FREGE_GITHUB_APP_CLIENT_ID = "Iv1.test-client";
  process.env.FREGE_GITHUB_APP_CLIENT_SECRET = "test-client-secret";
  const fake = setupVerificationSql();
  const fetchCalls = [];
  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url).includes("login/oauth/access_token")) {
      return Response.json({ access_token: "ghu_one_time_test" });
    }
    if (String(url).endsWith("/user")) return Response.json({ id: 99 });
    if (String(url).includes("/user/installations/42/repositories")) {
      return Response.json({ total_count: 1, repositories: [{ id: 7 }] });
    }
    if (String(url).includes("/applications/Iv1.test-client/token")) return new Response(null, { status: 204 });
    throw new Error(`unexpected setup fetch: ${url}`);
  };
  const auth = {
    user: { id: "00000000-0000-4000-8000-000000000010", email: "owner@example.test", name: "Owner" },
    membership: { role: "owner" },
    organization: {
      id: "00000000-0000-4000-8000-000000000001",
      slug: "acme",
      name: "Acme",
      status: "active",
    },
  };

  try {
    const result = await completeGitHubSetupOwnershipVerification(auth, {
      rawState: "s".repeat(43),
      code: "one-time-code",
      client: {
        requestAsApp: async () => Response.json({
          id: 42,
          repository_selection: "selected",
          permissions: { contents: "read" },
          suspended_at: null,
          account: { id: 9, login: "acme", type: "Organization" },
        }),
      },
      fetchImpl,
    }, fake.sql);
    assert.equal(result.installation_id, 42);
    assert.equal(result.verified_repository_count, 1);
    assert.equal(fake.calls.some((call) => call.query.startsWith("with consumed_state as")), true);
    const binding = fake.calls.find((call) => call.query.startsWith("with consumed_state as"));
    assert.equal(
      binding.values.some((value) => typeof value === "string" && value.includes('"verified_repository_ids":["7"]')),
      true,
    );
    assert.equal(fetchCalls.some((call) => call.init.method === "DELETE"), true);
    assert.equal(JSON.stringify(fake.calls).includes("ghu_one_time_test"), false);
  } finally {
    if (previousClientId === undefined) delete process.env.FREGE_GITHUB_APP_CLIENT_ID;
    else process.env.FREGE_GITHUB_APP_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.FREGE_GITHUB_APP_CLIENT_SECRET;
    else process.env.FREGE_GITHUB_APP_CLIENT_SECRET = previousClientSecret;
  }
});

test("webhook bounds and digests operate on the exact accepted bytes", () => {
  assert.equal(webhookBodyWithinLimit("x".repeat(1024 * 1024)), true);
  assert.equal(webhookBodyWithinLimit("x".repeat(1024 * 1024 + 1)), false);
  assert.notEqual(webhookPayloadDigest('{"a":1}'), webhookPayloadDigest('{ "a": 1 }'));
});

function webhookSql() {
  const state = { delivery: null, calls: [] };
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim();
    state.calls.push({ query, values });
    if (query.startsWith("insert into connector_webhook_deliveries")) {
      if (state.delivery) return [];
      state.delivery = {
        id: "delivery-row-1",
        delivery_id: values[0],
        payload_sha256: values[3],
        status: "received",
        lease_expires_at: null,
      };
      return [{ id: state.delivery.id }];
    }
    if (query.includes("select id, payload_sha256, status, lease_expires_at")) return state.delivery ? [state.delivery] : [];
    if (query.startsWith("update connector_webhook_deliveries")) {
      if (!state.delivery || state.delivery.payload_sha256 !== values[1] || state.delivery.status === "processing") return [];
      state.delivery.status = "processing";
      state.delivery.lease_expires_at = new Date(Date.now() + 600_000).toISOString();
      return [{ id: state.delivery.id }];
    }
    throw new Error(`unexpected query: ${query}`);
  };
  return { sql, state };
}

test("webhook deliveries deduplicate exact replays and reject digest collisions without storing payloads", async () => {
  const fake = webhookSql();
  const rawBody = JSON.stringify({ action: "created", installation: { id: 42 }, repository: { id: 7 }, secret: "do-not-store" });
  const first = await claimGitHubWebhook({
    deliveryId: "delivery-1",
    eventName: "push",
    rawBody,
    payload: JSON.parse(rawBody),
    sql: fake.sql,
  });
  assert.equal(first.duplicate, false);
  const replay = await claimGitHubWebhook({
    deliveryId: "delivery-1",
    eventName: "push",
    rawBody,
    payload: JSON.parse(rawBody),
    sql: fake.sql,
  });
  assert.equal(replay.duplicate, true);
  await assert.rejects(
    claimGitHubWebhook({
      deliveryId: "delivery-1",
      eventName: "push",
      rawBody: `${rawBody} `,
      payload: JSON.parse(rawBody),
      sql: fake.sql,
    }),
    /github_delivery_digest_collision/,
  );
  assert.equal(fake.state.calls.some((call) => call.values.includes(rawBody)), false);
  assert.equal(JSON.stringify(fake.state.calls).includes("do-not-store"), false);
});

function connectorRow() {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    org_id: "00000000-0000-4000-8000-000000000001",
    installation_id: "50000000-0000-4000-8000-000000000001",
    external_installation_id: "42",
    account_id: "9",
    account_login: "acme",
    installation_status: "active",
    external_resource_id: "7",
    display_name: "acme/repo",
    source_id: "60000000-0000-4000-8000-000000000001",
    source_slug: "github-acme-repo-id",
    service_principal_id: "10000000-0000-4000-8000-000000000001",
    managed_credential_id: "20000000-0000-4000-8000-000000000001",
    policy_version_id: "30000000-0000-4000-8000-000000000001",
    source_ref: "main",
    status: "active",
    health_status: "pending",
    config: normalizeGitHubConnectorConfig({}),
    external_acl: {},
    sync_cursor: null,
    etag: null,
    last_attempt_at: null,
    last_success_at: null,
    last_error_code: null,
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
  };
}

test("a denied or cross-tenant receipt performs zero GitHub requests and zero connector writes", async () => {
  const row = connectorRow();
  let writes = 0;
  const sql = async (query, params) => {
    if (typeof query === "string" && query.includes("from connector_sources")) return [row];
    writes += 1;
    return [];
  };
  const auth = {
    organization: { id: row.org_id, slug: "acme", name: "Acme", status: "active" },
    principal: { id: row.service_principal_id },
    credential: { id: row.managed_credential_id },
  };
  const receipt = {
    id: "70000000-0000-4000-8000-000000000001",
    org_id: row.org_id,
    principal: { id: row.service_principal_id, type: "service" },
    delegated_credential_id: row.managed_credential_id,
    action: "connector.sync",
    resource: { type: "github.repository", id: row.id },
    decision: "deny",
  };
  let fetches = 0;
  await assert.rejects(
    syncGitHubConnector({
      connectorId: row.id,
      auth,
      receipt,
      triggerKind: "manual",
      idempotencyKey: "deny-test",
      client: { createInstallationToken: async () => { fetches += 1; } },
      sql,
    }),
    /connector_authorization_invalid/,
  );
  assert.equal(fetches, 0);
  assert.equal(writes, 0);
});
