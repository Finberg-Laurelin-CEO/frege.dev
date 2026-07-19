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
  MAX_GITHUB_PUSH_DELIVERY_ATTEMPTS,
  claimPendingGitHubPushWebhooks,
  listRecoverableGitHubInitialSyncs,
} = await import("../../lib/core/github-webhook.ts");

test("push recovery claims bounded payload-free rows with incremented attempt fencing", async () => {
  let query = "";
  let values = [];
  const sql = async (strings, ...params) => {
    query = strings.join(" ? ").replace(/\s+/g, " ").trim();
    values = params;
    return [{
      id: "delivery-row-1",
      delivery_id: "delivery-1",
      event_name: "push",
      payload_sha256: "a".repeat(64),
      attempt_count: 3,
    }];
  };

  const claims = await claimPendingGitHubPushWebhooks({ limit: 999, sql });
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].payload, {});
  assert.equal(claims[0].attemptCount, 3);
  assert.equal(MAX_GITHUB_PUSH_DELIVERY_ATTEMPTS, 5);
  assert.match(query, /attempt_count < \?/);
  assert.match(query, /status = 'processing'.*attempt_count = deliveries\.attempt_count \+ 1/);
  assert.match(query, /for update skip locked/);
  assert.match(query, /connector_sync_runs\.status = 'running'.*lease_expires_at > now\(\)/);
  assert.match(query, /idempotency_key = 'github-delivery:' \|\| deliveries\.delivery_id/);
  assert.match(query, /connector_sync_runs\.status = 'failed'.*retry_after > now\(\)/);
  assert.equal(values.includes(10), true, "claim limit is clamped before SQL");
});

test("initial recovery uses a stable connector-generation key and bounded due work", async () => {
  let query = "";
  const sql = async (strings) => {
    query = strings.join(" ? ").replace(/\s+/g, " ").trim();
    return [{ id: "00000000-0000-4000-8000-000000000123", generation: 4 }];
  };
  const rows = await listRecoverableGitHubInitialSyncs({ limit: 1, sql });
  assert.deepEqual(rows, [{
    connectorId: "00000000-0000-4000-8000-000000000123",
    generation: 4,
    idempotencyKey: "github-initial:00000000-0000-4000-8000-000000000123:generation:4",
  }]);
  assert.match(query, /last_success_at is null/);
  assert.match(query, /health_status in \('pending', 'degraded'\)/);
  assert.match(query, /status = 'running'.*lease_expires_at > now\(\)/);
  assert.match(query, /status = 'failed'.*retry_after > now\(\)/);
  assert.match(query, /max\(connector_sync_runs\.attempt_number\)/);
});

test("push connector resolution and completion are fenced to the stored delivery attempt", async () => {
  const source = await readFile(path.join(rootDir, "lib/core/github-webhook.ts"), "utf8");
  const start = source.indexOf("async function connectorForStoredPushDelivery");
  const end = source.indexOf("async function connectorForWebhookPayload", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const resolver = source.slice(start, end).replace(/\s+/g, " ");
  assert.match(resolver, /from connector_webhook_deliveries/);
  assert.match(resolver, /external_installation_id = connector_webhook_deliveries\.external_installation_id/);
  assert.match(resolver, /external_resource_id = connector_webhook_deliveries\.external_resource_id/);
  assert.match(resolver, /status = 'processing'/);
  assert.match(resolver, /attempt_count = \$\{claim\.attemptCount\}/);

  const marker = source.slice(source.indexOf("async function markDelivery"), source.indexOf("async function connectorsForInstallation"));
  assert.match(marker.replace(/\s+/g, " "), /status = 'processing'.*attempt_count = \$\{input\.claim\.attemptCount\}/);
});

test("webhook route acknowledges push asynchronously but completes authority events synchronously", async () => {
  const route = await readFile(
    path.join(rootDir, "app/api/v2/connectors/github/webhook/route.ts"),
    "utf8",
  );
  assert.match(route, /eventName === "push"[\s\S]*after\(async \(\) =>/);
  assert.match(route, /else if \(!claim\.duplicate\)[\s\S]*await processClaimedGitHubWebhook\(claim\)/);
  assert.match(route, /status: eventName === "push" \? 202 : 200/);
  assert.match(route, /claim\.duplicate[\s\S]*eventName !== "push"[\s\S]*status: 503/);
});

test("cron recovery uses standard guards, run ledger, and bounded lanes", async () => {
  const route = await readFile(
    path.join(rootDir, "app/api/cron/github-connector-worker/route.ts"),
    "utf8",
  );
  assert.match(route, /isCronAuthorized\(req\)/);
  assert.match(route, /cronsEnabled\(\)/);
  assert.match(route, /recordCronRun\("github-connector-worker"/);
  assert.match(route, /const CLAIM_LIMIT = 2/);
  assert.match(route, /const INITIAL_SYNC_LIMIT = 1/);
  assert.match(route, /idempotencyKey: pending\.idempotencyKey/);

  const config = JSON.parse(await readFile(path.join(rootDir, "vercel.json"), "utf8"));
  assert.equal(
    config.crons.some((cron) => cron.path === "/api/cron/github-connector-worker" && cron.schedule === "* * * * *"),
    true,
  );
});
