import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  GITHUB_API_VERSION,
  GitHubAppClient,
  createGitHubAppJwt,
  verifyGitHubWebhookSignature,
} from "../../lib/core/github-app.ts";
import {
  DEFAULT_GITHUB_CONNECTOR_CONFIG,
  githubGlobToRegExp,
  githubPageSlug,
  githubSourceSlug,
  normalizeGitHubConnectorConfig,
  selectGitHubTreeEntries,
} from "../../lib/core/github-connector-contract.ts";

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

const { claimGitHubWebhook, processClaimedGitHubWebhook } = await import("../../lib/core/github-webhook.ts");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

test("GitHub App JWT is short-lived RS256 and verifies", () => {
  const token = createGitHubAppJwt({ appId: "12345", privateKey: privatePem, nowSeconds: 1_800_000_000 });
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), {
    iat: 1_799_999_940,
    exp: 1_800_000_540,
    iss: "12345",
  });
  assert.equal(
    sign("RSA-SHA256", Buffer.from("wrong payload"), privateKey).equals(Buffer.from(signature, "base64url")),
    false,
  );
  assert.equal(
    verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")),
    true,
  );
});

test("webhook signatures use the documented HMAC-SHA256 contract", () => {
  assert.equal(
    verifyGitHubWebhookSignature({
      body: "Hello, World!",
      signature: "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      secret: "It's a Secret to Everybody",
    }),
    true,
  );
  assert.equal(
    verifyGitHubWebhookSignature({ body: "tampered", signature: "sha256=".padEnd(71, "0"), secret: "secret" }),
    false,
  );
});

test("installation token client pins API version and makes no token-length assumption", async () => {
  const calls = [];
  const client = new GitHubAppClient({
    appId: "12345",
    privateKey: privatePem,
    now: () => 1_800_000_000_000,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ token: "ghs_APPID_JWT.stateless-format", expires_at: "2027-01-15T08:10:00Z" });
    },
  });
  const token = await client.createInstallationToken({
    installationId: 42,
    repositoryIds: [7],
    permissions: { contents: "read" },
  });
  assert.equal(token.token, "ghs_APPID_JWT.stateless-format");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.get("x-github-api-version"), GITHUB_API_VERSION);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    repository_ids: [7],
    permissions: { contents: "read" },
  });
});

test("connector path policy is default-restricted and deterministic", () => {
  const config = normalizeGitHubConnectorConfig({});
  assert.equal(config.trust_zone, "red");
  assert.equal(githubGlobToRegExp("docs/**/*.md").test("docs/runbooks/release.md"), true);
  assert.equal(githubGlobToRegExp("docs/**/*.md").test("src/index.ts"), false);
  const selected = selectGitHubTreeEntries([
    { path: "README.md", mode: "100644", type: "blob", sha: "a", size: 100 },
    { path: "docs/release.md", mode: "100644", type: "blob", sha: "b", size: 100 },
    { path: "docs/.env.production.md", mode: "100644", type: "blob", sha: "c", size: 100 },
    { path: "private/strategy.md", mode: "100644", type: "blob", sha: "d", size: 100 },
    { path: "docs/private/strategy.md", mode: "100644", type: "blob", sha: "d2", size: 100 },
    { path: "docs/secrets/token.md", mode: "100644", type: "blob", sha: "d3", size: 100 },
    { path: "docs/missing-size.md", mode: "100644", type: "blob", sha: "d4" },
    { path: "docs/link.md", mode: "120000", type: "blob", sha: "d5", size: 100 },
    { path: "docs/large.md", mode: "100644", type: "blob", sha: "e", size: 400_000 },
    { path: "src/index.ts", mode: "100644", type: "blob", sha: "f", size: 100 },
  ], DEFAULT_GITHUB_CONNECTOR_CONFIG);
  assert.deepEqual(selected.map((entry) => entry.path), ["README.md", "docs/release.md"]);
});

test("repository and page identities are stable and source-scoped", () => {
  const source = githubSourceSlug("Acme-Inc", "Agent OS", 77);
  const page = githubPageSlug("Acme-Inc", "Agent OS", "docs/Release Notes.md", 77);
  assert.match(source, /^github-acme-inc-agent-os-[a-f0-9]{12}$/);
  assert.match(page, /^github-acme-inc-agent-os-[a-f0-9]{12}-docs-release-notes-[a-f0-9]{12}$/);
  assert.equal(source, githubSourceSlug("Acme-Inc", "Agent OS", 77));
  assert.equal(page, githubPageSlug("Acme-Inc", "Agent OS", "docs/Release Notes.md", 77));
  assert.notEqual(source, githubSourceSlug("Acme-Inc", "Agent OS", 78));
  assert.notEqual(page, githubPageSlug("Acme-Inc", "Agent OS", "docs/Other Notes.md", 77));
});

test("long page identities retain their digest and do not collapse after slug budgeting", () => {
  const owner = "organization-with-an-extremely-long-and-similar-identity-name";
  const repository = "repository-with-an-extremely-long-and-similar-identity-name";
  const shared = `docs/${"shared-long-directory-name-".repeat(5)}`;
  const first = githubPageSlug(owner, repository, `${shared}first.md`, 123456789);
  const second = githubPageSlug(owner, repository, `${shared}second.md`, 123456789);

  assert.equal(first.length <= 180, true);
  assert.equal(second.length <= 180, true);
  assert.match(first, /-[a-f0-9]{12}$/);
  assert.match(second, /-[a-f0-9]{12}$/);
  assert.notEqual(first, second);
});

function fencedWebhookSql() {
  const state = { delivery: null };
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim();
    if (query.startsWith("insert into connector_webhook_deliveries")) {
      if (state.delivery) return [];
      state.delivery = {
        id: "delivery-row-1",
        delivery_id: values[0],
        payload_sha256: values[3],
        status: "received",
        attempt_count: 0,
        lease_expires_at: null,
      };
      return [{ id: state.delivery.id }];
    }
    if (query.includes("select id, payload_sha256, status, lease_expires_at, attempt_count")) {
      return state.delivery ? [state.delivery] : [];
    }
    if (query.startsWith("update connector_webhook_deliveries") && query.includes("set status = 'processing'")) {
      const leaseExpired = state.delivery?.lease_expires_at && new Date(state.delivery.lease_expires_at).getTime() <= Date.now();
      const claimable = state.delivery && (
        ["received", "failed"].includes(state.delivery.status) ||
        (state.delivery.status === "processing" && leaseExpired)
      );
      if (!claimable || state.delivery.payload_sha256 !== values[1]) return [];
      state.delivery.status = "processing";
      state.delivery.attempt_count += 1;
      state.delivery.lease_expires_at = new Date(Date.now() + 600_000).toISOString();
      return [{ id: state.delivery.id, attempt_count: state.delivery.attempt_count }];
    }
    if (query.startsWith("update connector_webhook_deliveries") && query.includes("set status = ?")) {
      const attemptCount = values[7];
      if (
        state.delivery &&
        state.delivery.id === values[4] &&
        state.delivery.delivery_id === values[5] &&
        state.delivery.payload_sha256 === values[6] &&
        state.delivery.status === "processing" &&
        state.delivery.attempt_count === attemptCount
      ) {
        state.delivery.status = values[0];
        state.delivery.lease_expires_at = null;
      }
      return [];
    }
    throw new Error(`unexpected query: ${query}`);
  };
  return { sql, state };
}

test("a stale webhook attempt cannot finalize a delivery reclaimed by a newer attempt", async () => {
  const fake = fencedWebhookSql();
  const rawBody = JSON.stringify({ zen: "governed memory" });
  const input = {
    deliveryId: "delivery-fence-1",
    eventName: "ping",
    rawBody,
    payload: JSON.parse(rawBody),
    sql: fake.sql,
  };
  const first = await claimGitHubWebhook(input);
  assert.equal(first.attemptCount, 1);

  fake.state.delivery.lease_expires_at = new Date(Date.now() - 1_000).toISOString();
  const second = await claimGitHubWebhook(input);
  assert.equal(second.attemptCount, 2);

  await processClaimedGitHubWebhook(first, fake.sql);
  assert.equal(fake.state.delivery.status, "processing");
  await processClaimedGitHubWebhook(second, fake.sql);
  assert.equal(fake.state.delivery.status, "processed");
});

test("GitHub reads retry bounded transient failures and reject expired or mismatched installation grants", async () => {
  let attempts = 0;
  const client = new GitHubAppClient({
    appId: "12345",
    privateKey: privatePem,
    now: () => 1_800_000_000_000,
    sleep: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return new Response("unavailable", { status: 503 });
      return Response.json({
        token: "stateless-token",
        expires_at: "2027-01-15T08:10:00Z",
        repositories: [{ id: 7, name: "repo", full_name: "acme/repo" }],
      });
    },
  });
  await client.createInstallationToken({ installationId: 42, repositoryIds: [7], permissions: { contents: "read" } });
  assert.equal(attempts, 2);

  const expired = new GitHubAppClient({
    appId: "12345",
    privateKey: privatePem,
    now: () => 1_800_000_000_000,
    fetchImpl: async () => Response.json({ token: "token", expires_at: "2020-01-01T00:00:00Z" }),
  });
  await assert.rejects(
    expired.createInstallationToken({ installationId: 42, repositoryIds: [7] }),
    /github_installation_token_expiry_invalid/,
  );

  const mismatch = new GitHubAppClient({
    appId: "12345",
    privateKey: privatePem,
    now: () => 1_800_000_000_000,
    fetchImpl: async () => Response.json({
      token: "token",
      expires_at: "2027-01-15T08:10:00Z",
      repositories: [{ id: 8, name: "other", full_name: "acme/other" }],
    }),
  });
  await assert.rejects(
    mismatch.createInstallationToken({ installationId: 42, repositoryIds: [7] }),
    /github_installation_token_scope_mismatch/,
  );
});
