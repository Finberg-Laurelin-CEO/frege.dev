#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const enabled = process.env.GITHUB_CONNECTOR_INTEGRATION === "1";
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
  revokeGitHubConnectorFromProvider,
  syncGitHubConnector,
} = await import("../../lib/core/github-connector.ts");
const { normalizeGitHubConnectorConfig } = await import("../../lib/core/github-connector-contract.ts");
const { loadInternalV2CredentialAuth } = await import("../../lib/v2/control-plane.ts");

function parameterize(stringsOrText, values) {
  if (typeof stringsOrText === "string") {
    return { query: stringsOrText, params: values[0] ?? [] };
  }
  let query = "";
  stringsOrText.forEach((part, index) => {
    query += part;
    if (index < values.length) query += `$${index + 1}`;
  });
  return { query, params: values };
}

function deferredQuery(parameterizedQuery, execute) {
  return {
    [Symbol.toStringTag]: "NeonQueryPromise",
    parameterizedQuery,
    then: (onFulfilled, onRejected) => execute().then(onFulfilled, onRejected),
    catch: (onRejected) => execute().catch(onRejected),
    finally: (onFinally) => execute().finally(onFinally),
  };
}

/** Minimal Neon-compatible adapter so runtime code and assertions share one pg pool. */
function makeSql(pool) {
  const tagged = (stringsOrText, ...values) => {
    const parameterizedQuery = parameterize(stringsOrText, values);
    return deferredQuery(parameterizedQuery, async () => {
      const result = await pool.query(parameterizedQuery.query, parameterizedQuery.params);
      return result.rows;
    });
  };

  tagged.transaction = async (queriesOrFn) => {
    const client = await pool.connect();
    const transactionSql = (stringsOrText, ...values) => {
      const parameterizedQuery = parameterize(stringsOrText, values);
      return deferredQuery(parameterizedQuery, async () => {
        const result = await client.query(parameterizedQuery.query, parameterizedQuery.params);
        return result.rows;
      });
    };
    try {
      await client.query("begin");
      const queries = typeof queriesOrFn === "function" ? queriesOrFn(transactionSql) : queriesOrFn;
      assert.ok(Array.isArray(queries), "transaction() expects an array of deferred queries");
      const results = [];
      for (const query of queries) {
        assert.equal(query?.[Symbol.toStringTag], "NeonQueryPromise");
        const result = await client.query(query.parameterizedQuery.query, query.parameterizedQuery.params);
        results.push(result.rows);
      }
      await client.query("commit");
      return results;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  return tagged;
}

function numericExternalId() {
  const value = BigInt(`0x${randomBytes(6).toString("hex")}`) % 8_000_000_000_000n;
  return Number(1_000_000_000_000n + value);
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

class FakeGitHubAppClient {
  constructor({ installationId, repositoryId, repository, documents }) {
    this.installationId = installationId;
    this.repositoryId = repositoryId;
    this.repository = repository;
    this.documents = documents;
    this.scenario = "initial";
    this.calls = [];
  }

  async createInstallationToken(input) {
    this.calls.push({ kind: "token", input });
    assert.deepEqual(input, {
      installationId: this.installationId,
      repositoryIds: [this.repositoryId],
      permissions: { contents: "read" },
    });
    return {
      token: "test-installation-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      repositoryIds: [this.repositoryId],
      permissions: { contents: "read" },
    };
  }

  async request(token, requestPath, _init = {}, etag) {
    assert.equal(token, "test-installation-token");
    this.calls.push({ kind: "request", path: requestPath, etag: etag ?? null, scenario: this.scenario });

    if (requestPath === `/repositories/${this.repositoryId}`) {
      return jsonResponse(this.repository);
    }

    if (requestPath.includes("/git/trees/")) {
      if (this.scenario === "truncated") {
        return jsonResponse({
          sha: "commit-truncated",
          truncated: true,
          tree: [this.documents.readme.entry],
        }, { headers: { etag: '"commit-truncated"' } });
      }
      if (this.scenario === "blob-failure") {
        return jsonResponse({
          sha: "commit-broken",
          truncated: false,
          tree: [this.documents.changedReadme.entry],
        }, { headers: { etag: '"commit-broken"' } });
      }
      if (this.scenario === "deletion") {
        return jsonResponse({
          sha: "commit-delete-guide",
          truncated: false,
          tree: [this.documents.readme.entry],
        }, { headers: { etag: '"commit-delete-guide"' } });
      }
      return jsonResponse({
        sha: "commit-initial",
        truncated: false,
        tree: [this.documents.guide.entry, this.documents.readme.entry],
      }, { headers: { etag: '"commit-initial"' } });
    }

    const blobSha = decodeURIComponent(requestPath.split("/").at(-1));
    if (this.scenario === "blob-failure" && blobSha === this.documents.changedReadme.entry.sha) {
      return jsonResponse({ message: "simulated upstream failure" }, { status: 502 });
    }
    const document = Object.values(this.documents).find((candidate) => candidate.entry.sha === blobSha);
    assert.ok(document, `unexpected blob request: ${blobSha}`);
    return jsonResponse({
      sha: document.entry.sha,
      size: document.entry.size,
      encoding: "base64",
      content: Buffer.from(document.body, "utf8").toString("base64"),
    });
  }
}

async function seedFixture(pool, ids, config, rules, rulesDigest) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into organizations (id, slug, name, status, activated_at)
       values ($1, $2, $3, 'active', now())`,
      [ids.org, ids.orgSlug, "GitHub connector integration"],
    );
    await client.query(
      `insert into users (id, email, name, status, email_verified_at)
       values ($1, $2, $3, 'active', now())`,
      [ids.user, `${ids.orgSlug}@example.test`, "Integration owner"],
    );
    await client.query(
      `insert into organization_memberships (org_id, user_id, role, status)
       values ($1, $2, 'owner', 'active')`,
      [ids.org, ids.user],
    );
    await client.query(
      `insert into control_principals (
         id, org_id, principal_type, slug, name, status
       ) values ($1, $2, 'service', $3, $4, 'active')`,
      [ids.principal, ids.org, `github-sync-${ids.suffix}`, "Governed GitHub sync"],
    );
    await client.query(
      `insert into control_policy_versions (
         id, org_id, slug, version, default_decision, rules, rules_digest, created_by_principal_id
       ) values ($1, $2, $3, 1, 'deny', $4::jsonb, $5, $6)`,
      [ids.policy, ids.org, `github-policy-${ids.suffix}`, JSON.stringify(rules), rulesDigest, ids.principal],
    );
    await client.query(
      `insert into delegated_credentials (
         id, org_id, principal_id, delegated_by_principal_id, policy_version_id,
         name, key_prefix, key_hash, scopes, status
       ) values ($1, $2, $3, $3, $4, $5, $6, $7, array['connector.sync']::text[], 'active')`,
      [
        ids.credential,
        ids.org,
        ids.principal,
        ids.policy,
        "Managed integration-test authority",
        ids.keyPrefix,
        ids.keyHash,
      ],
    );
    await client.query(
      `insert into brain_sources (
         id, org_id, slug, name, kind, status, trust_zone, config, metadata,
         created_by_user_id, approved_by_user_id
       ) values ($1, $2, $3, $4, 'github', 'active', $5, $6::jsonb, $7::jsonb, $8, $8)`,
      [
        ids.source,
        ids.org,
        `github-integration-${ids.suffix}`,
        "acme/frege-integration",
        config.trust_zone,
        JSON.stringify(config),
        JSON.stringify({ provider: "github", integration_test: true }),
        ids.user,
      ],
    );
    await client.query(
      `insert into connector_installations (
         id, org_id, provider, external_installation_id, account_id, account_login,
         status, requested_scopes, external_acl, created_by_principal_id
       ) values ($1, $2, 'github', $3, $4, 'acme', 'active', $5::jsonb, $6::jsonb, $7)`,
      [
        ids.installation,
        ids.org,
        String(ids.externalInstallation),
        String(ids.externalAccount),
        JSON.stringify({ contents: "read" }),
        JSON.stringify({ verified_repository_ids: [String(ids.externalRepository)] }),
        ids.principal,
      ],
    );
    await client.query(
      `insert into connector_sources (
         id, org_id, installation_id, provider, external_resource_id, display_name,
         source_id, service_principal_id, managed_credential_id, policy_version_id,
         generation, source_ref, status, health_status, config, external_acl
       ) values (
         $1, $2, $3, 'github', $4, 'acme/frege-integration',
         $5, $6, $7, $8, 1, 'main', 'active', 'pending', $9::jsonb, $10::jsonb
       )`,
      [
        ids.connector,
        ids.org,
        ids.installation,
        String(ids.externalRepository),
        ids.source,
        ids.principal,
        ids.credential,
        ids.policy,
        JSON.stringify(config),
        JSON.stringify({ mapping: "repository-bound" }),
      ],
    );
    await client.query(
      `insert into authorization_receipts (
         id, org_id, principal_id, delegated_credential_id, policy_version_id,
         correlation_id, request_id, action, resource_type, resource_id,
         decision, matching_rule_id, reason_code
       ) values (
         $1, $2, $3, $4, $5, $6, $7, 'connector.sync', 'github.repository', $8,
         'allow', 'allow-connector-sync', 'allowed_by_policy'
       )`,
      [
        ids.receipt,
        ids.org,
        ids.principal,
        ids.credential,
        ids.policy,
        ids.correlation,
        `github-integration-${ids.suffix}`,
        ids.connector,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function rows(pool, query, params = []) {
  return (await pool.query(query, params)).rows;
}

test("governed GitHub connector persists only complete authoritative snapshots", { skip: !enabled }, async () => {
  assert.equal(process.env.LOCAL_PG, "1", "set LOCAL_PG=1 for the integration test");
  assert.ok(process.env.DATABASE_URL, "set DATABASE_URL for the migrated disposable database");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
  const sql = makeSql(pool);
  const suffix = randomBytes(4).toString("hex");
  const ids = {
    suffix,
    org: randomUUID(),
    orgSlug: `github-integration-${suffix}`,
    user: randomUUID(),
    principal: randomUUID(),
    policy: randomUUID(),
    credential: randomUUID(),
    installation: randomUUID(),
    source: randomUUID(),
    connector: randomUUID(),
    receipt: randomUUID(),
    correlation: randomUUID(),
    keyPrefix: randomBytes(6).toString("hex"),
    keyHash: randomBytes(32).toString("hex"),
    externalInstallation: numericExternalId(),
    externalRepository: numericExternalId(),
    externalAccount: numericExternalId(),
  };
  const config = normalizeGitHubConnectorConfig({ trust_zone: "red" });
  const rules = [{
    id: "allow-connector-sync",
    effect: "allow",
    actions: ["connector.sync"],
    resource_types: ["github.repository"],
    principal_ids: [ids.principal],
    resource_ids: [ids.connector],
  }];
  const rulesDigest = createHash("sha256").update(JSON.stringify(rules)).digest("hex");
  const now = new Date().toISOString();
  const auth = {
    organization: { id: ids.org, slug: ids.orgSlug, name: "GitHub connector integration", status: "active" },
    principal: {
      id: ids.principal,
      org_id: ids.org,
      principal_type: "service",
      slug: `github-sync-${suffix}`,
      name: "Governed GitHub sync",
      status: "active",
      subject_user_id: null,
      subject_agent_id: null,
      created_by_principal_id: null,
      created_at: now,
      updated_at: now,
    },
    credential: {
      id: ids.credential,
      org_id: ids.org,
      principal_id: ids.principal,
      delegated_by_principal_id: ids.principal,
      policy_version_id: ids.policy,
      name: "Managed integration-test authority",
      key_prefix: ids.keyPrefix,
      scopes: ["connector.sync"],
      status: "active",
      not_before: now,
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      created_at: now,
    },
    policy: {
      id: ids.policy,
      org_id: ids.org,
      slug: `github-policy-${suffix}`,
      version: 1,
      default_decision: "deny",
      rules,
      rules_digest: rulesDigest,
      created_by_principal_id: ids.principal,
      created_at: now,
      valid: true,
    },
  };
  const receipt = {
    id: ids.receipt,
    org_id: ids.org,
    principal: { id: ids.principal, type: "service" },
    delegated_credential_id: ids.credential,
    correlation_id: ids.correlation,
    request_id: `github-integration-${suffix}`,
    action: "connector.sync",
    resource: { type: "github.repository", id: ids.connector },
    decision: "allow",
    policy: {
      id: ids.policy,
      slug: `github-policy-${suffix}`,
      version: 1,
      rules_digest: rulesDigest,
      matching_rule_id: "allow-connector-sync",
    },
    reason_code: "allowed_by_policy",
    created_at: now,
  };

  const readmeBody = "# Frege integration\n\nGoverned memory for agents.\n";
  const guideBody = "# Operator guide\n\nEvery write leaves a receipt.\n";
  const changedReadmeBody = "# Frege integration\n\nThis blob must never be persisted.\n";
  const documents = {
    readme: {
      body: readmeBody,
      entry: { path: "README.md", mode: "100644", type: "blob", sha: "blob-readme-a", size: Buffer.byteLength(readmeBody) },
    },
    guide: {
      body: guideBody,
      entry: { path: "docs/guide.md", mode: "100644", type: "blob", sha: "blob-guide-a", size: Buffer.byteLength(guideBody) },
    },
    changedReadme: {
      body: changedReadmeBody,
      entry: { path: "README.md", mode: "100644", type: "blob", sha: "blob-readme-b", size: Buffer.byteLength(changedReadmeBody) },
    },
  };
  const repository = {
    id: ids.externalRepository,
    node_id: `R_${suffix}`,
    name: "frege-integration",
    full_name: "acme/frege-integration",
    private: true,
    visibility: "private",
    default_branch: "main",
    archived: false,
    disabled: false,
    owner: { id: ids.externalAccount, login: "acme" },
  };
  const client = new FakeGitHubAppClient({
    installationId: ids.externalInstallation,
    repositoryId: ids.externalRepository,
    repository,
    documents,
  });

  try {
    await seedFixture(pool, ids, config, rules, rulesDigest);

    const initial = await syncGitHubConnector({
      connectorId: ids.connector,
      auth,
      receipt,
      triggerKind: "initial",
      idempotencyKey: `initial-${suffix}`,
      client,
      sql,
    });
    assert.equal(initial.status, "succeeded");
    assert.deepEqual(
      [initial.selected_count, initial.fetched_count, initial.created_count, initial.updated_count, initial.deleted_count, initial.unchanged_count],
      [2, 2, 2, 0, 0, 0],
    );
    assert.equal(initial.snapshot_authoritative, true);
    assert.equal(initial.deletion_applied, true);

    const initialMappings = await rows(pool, `
      select
        items.source_path,
        items.external_revision,
        items.status as item_status,
        pages.status as page_status,
        pages.trust_zone,
        revisions.id as exact_revision_id,
        revisions.body_md
      from connector_source_items items
      join brain_pages pages
        on pages.org_id = items.org_id and pages.id = items.page_id
      join brain_page_revisions revisions
        on revisions.org_id = items.org_id
       and revisions.page_id = items.page_id
       and revisions.id = items.page_revision_id
      where items.org_id = $1 and items.connector_source_id = $2
      order by items.source_path`, [ids.org, ids.connector]);
    const initialByPath = Object.fromEntries(initialMappings.map((row) => [row.source_path, row]));
    assert.deepEqual(Object.keys(initialByPath).sort(), ["README.md", "docs/guide.md"].sort());
    assert.equal(initialByPath["README.md"].external_revision, "blob-readme-a");
    assert.equal(initialByPath["docs/guide.md"].external_revision, "blob-guide-a");
    assert.ok(initialMappings.every((row) => row.item_status === "active"));
    assert.ok(initialMappings.every((row) => row.page_status === "published"));
    assert.ok(initialMappings.every((row) => row.trust_zone === "red"));
    assert.equal(initialByPath["README.md"].body_md, readmeBody);
    assert.equal(initialByPath["docs/guide.md"].body_md, guideBody);

    const callsBeforeIdempotentReplay = client.calls.length;
    const replay = await syncGitHubConnector({
      connectorId: ids.connector,
      auth,
      receipt,
      triggerKind: "manual",
      idempotencyKey: `initial-${suffix}`,
      client,
      sql,
    });
    assert.equal(replay.id, initial.id);
    assert.equal(client.calls.length, callsBeforeIdempotentReplay, "idempotent replay must not call GitHub");
    assert.equal((await rows(pool, `select count(*)::int as count from brain_page_revisions where org_id = $1`, [ids.org]))[0].count, 2);

    client.scenario = "same";
    const noop = await syncGitHubConnector({
      connectorId: ids.connector,
      auth,
      receipt,
      triggerKind: "manual",
      idempotencyKey: `same-commit-${suffix}`,
      client,
      sql,
    });
    assert.equal(noop.status, "noop");
    assert.deepEqual(
      [noop.selected_count, noop.fetched_count, noop.deleted_count, noop.unchanged_count],
      [2, 0, 0, 2],
    );
    assert.equal((await rows(pool, `select count(*)::int as count from brain_page_revisions where org_id = $1`, [ids.org]))[0].count, 2);

    client.scenario = "truncated";
    await assert.rejects(
      syncGitHubConnector({
        connectorId: ids.connector,
        auth,
        receipt,
        triggerKind: "webhook",
        idempotencyKey: `truncated-${suffix}`,
        client,
        sql,
      }),
      /github_tree_truncated/,
    );
    const [truncatedRun] = await rows(pool, `
      select status, snapshot_authoritative, deletion_applied, error_code
      from connector_sync_runs
      where org_id = $1 and connector_source_id = $2 and idempotency_key = $3`,
    [ids.org, ids.connector, `truncated-${suffix}`]);
    assert.deepEqual(truncatedRun, {
      status: "failed",
      snapshot_authoritative: false,
      deletion_applied: false,
      error_code: "github_tree_truncated",
    });
    assert.equal((await rows(pool, `select count(*)::int as count from connector_source_items where org_id = $1 and status = 'active'`, [ids.org]))[0].count, 2);

    client.scenario = "blob-failure";
    await assert.rejects(
      syncGitHubConnector({
        connectorId: ids.connector,
        auth,
        receipt,
        triggerKind: "webhook",
        idempotencyKey: `blob-failure-${suffix}`,
        client,
        sql,
      }),
      /github_blob_read_failed:502/,
    );
    const [blobFailureRun] = await rows(pool, `
      select status, snapshot_authoritative, deletion_applied, error_code
      from connector_sync_runs
      where org_id = $1 and connector_source_id = $2 and idempotency_key = $3`,
    [ids.org, ids.connector, `blob-failure-${suffix}`]);
    assert.deepEqual(blobFailureRun, {
      status: "failed",
      snapshot_authoritative: true,
      deletion_applied: false,
      error_code: "github_http_502",
    });
    assert.equal((await rows(pool, `select count(*)::int as count from connector_source_items where org_id = $1 and status = 'active'`, [ids.org]))[0].count, 2);
    assert.equal((await rows(pool, `select count(*)::int as count from brain_page_revisions where org_id = $1`, [ids.org]))[0].count, 2);

    client.scenario = "deletion";
    const deletion = await syncGitHubConnector({
      connectorId: ids.connector,
      auth,
      receipt,
      triggerKind: "webhook",
      idempotencyKey: `deletion-${suffix}`,
      client,
      sql,
    });
    assert.equal(deletion.status, "succeeded");
    assert.deepEqual(
      [deletion.selected_count, deletion.fetched_count, deletion.deleted_count, deletion.unchanged_count],
      [1, 0, 1, 1],
    );
    const itemStates = await rows(pool, `
      select items.source_path, items.status as item_status, pages.status as page_status
      from connector_source_items items
      join brain_pages pages on pages.org_id = items.org_id and pages.id = items.page_id
      where items.org_id = $1 and items.connector_source_id = $2
      order by items.source_path`, [ids.org, ids.connector]);
    assert.deepEqual(itemStates.sort((left, right) => left.source_path.localeCompare(right.source_path)), [
      { source_path: "README.md", item_status: "active", page_status: "published" },
      { source_path: "docs/guide.md", item_status: "deleted", page_status: "archived" },
    ].sort((left, right) => left.source_path.localeCompare(right.source_path)));
    assert.equal((await rows(pool, `select count(*)::int as count from brain_page_revisions where org_id = $1`, [ids.org]))[0].count, 2);

    const completionEvents = await rows(pool, `
      select event_type, outcome, authorization_receipt_id, payload
      from provenance_events
      where org_id = $1 and resource_id = $2 and event_type = 'connector.sync.completed'
      order by created_at`, [ids.org, ids.connector]);
    assert.equal(completionEvents.length, 3);
    assert.ok(completionEvents.every((event) => event.outcome === "success"));
    assert.ok(completionEvents.every((event) => event.authorization_receipt_id === ids.receipt));
    assert.deepEqual(completionEvents.map((event) => event.payload.status), ["succeeded", "noop", "succeeded"]);

    const revoked = await revokeGitHubConnectorFromProvider(
      ids.connector,
      "repository_removed",
      sql,
    );
    assert.equal(revoked, true);
    const [revokedState] = await rows(pool, `
      select
        connectors.status as connector_status,
        connectors.health_status,
        connectors.generation,
        sources.status as source_status,
        credentials.status as credential_status,
        credentials.revoked_at,
        (select count(*)::int from brain_pages where org_id = connectors.org_id and source_id = connectors.source_id and status = 'archived') as archived_pages,
        (select count(*)::int from connector_source_items where org_id = connectors.org_id and connector_source_id = connectors.id and status = 'deleted') as deleted_items,
        (select count(*)::int from connector_sync_runs where org_id = connectors.org_id and connector_source_id = connectors.id and status = 'running') as running_runs
      from connector_sources connectors
      join brain_sources sources on sources.org_id = connectors.org_id and sources.id = connectors.source_id
      join delegated_credentials credentials on credentials.org_id = connectors.org_id and credentials.id = connectors.managed_credential_id
      where connectors.org_id = $1 and connectors.id = $2`, [ids.org, ids.connector]);
    assert.equal(revokedState.connector_status, "revoked");
    assert.equal(revokedState.health_status, "revoked");
    assert.equal(revokedState.generation, 2);
    assert.equal(revokedState.source_status, "disabled");
    assert.equal(revokedState.credential_status, "revoked");
    assert.ok(revokedState.revoked_at);
    assert.equal(revokedState.archived_pages, 2);
    assert.equal(revokedState.deleted_items, 2);
    assert.equal(revokedState.running_runs, 0);
    assert.equal(await loadInternalV2CredentialAuth({
      orgId: ids.org,
      credentialId: ids.credential,
      principalId: ids.principal,
    }, sql), null);
  } finally {
    await pool.query("delete from organizations where id = $1", [ids.org]).catch(() => undefined);
    await pool.query("delete from users where id = $1", [ids.user]).catch(() => undefined);
    await pool.end();
  }
});
