#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const { hostedExecutionDisabledResponse, hostedExecutionEnabled } = await import(
  pathToFileURL(path.join(root, "lib/core/hosted-execution.ts")).href
);

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function postBody(source) {
  const start = source.indexOf("export async function POST");
  assert.notEqual(start, -1, "route must define POST");
  return source.slice(start);
}

function getBody(source) {
  const start = source.indexOf("export async function GET");
  const end = source.indexOf("export async function POST", start);
  assert.notEqual(start, -1, "route must define GET");
  return source.slice(start, end === -1 ? undefined : end);
}

function assertGateBefore(source, marker, label) {
  const gate = source.indexOf("if (!hostedExecutionEnabled())");
  const protectedCall = source.indexOf(marker);
  assert.notEqual(gate, -1, `${label} is missing the hosted-execution gate`);
  assert.notEqual(protectedCall, -1, `${label} is missing ${marker}`);
  assert.ok(gate < protectedCall, `${label} must gate before ${marker}`);
}

test("hosted execution is exact-opt-in and defaults off", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) {
    assert.equal(hostedExecutionEnabled(value), false, `unexpected enable value: ${String(value)}`);
  }
  assert.equal(hostedExecutionEnabled("true"), true);

  const previous = process.env.FREGE_HOSTED_EXECUTION_ENABLED;
  delete process.env.FREGE_HOSTED_EXECUTION_ENABLED;
  try {
    assert.equal(hostedExecutionEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.FREGE_HOSTED_EXECUTION_ENABLED;
    else process.env.FREGE_HOSTED_EXECUTION_ENABLED = previous;
  }
});

test("disabled execution returns a stable non-cacheable contract", async () => {
  const response = hostedExecutionDisabledResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("retry-after"), false);
  assert.deepEqual(await response.json(), {
    error: "hosted_execution_disabled",
    message:
      "Run the agent in your own client and use Frege through MCP or the API for governed context and memory.",
  });
});

test("all execution ingress gates before parsing, queueing, claiming, or invoking", async () => {
  const [agents, model, claim, cron, adminAgents, adminModels] = await Promise.all([
    read("app/api/v1/agents/route.ts"),
    read("app/api/v1/model/invoke/route.ts"),
    read("app/api/v1/runtime/agent-runs/claim/route.ts"),
    read("app/api/cron/agent-worker/route.ts"),
    read("app/api/v1/admin/agents/route.ts"),
    read("app/api/v1/admin/model-configs/route.ts"),
  ]);

  assertGateBefore(postBody(agents), "readJson(req)", "agent enqueue");
  assertGateBefore(postBody(agents), "enqueueAgentRun(", "agent enqueue");
  assertGateBefore(postBody(model), "readJson(req)", "model invoke");
  assertGateBefore(postBody(model), "invokeModel({", "model invoke");
  assertGateBefore(postBody(claim), "readJson(req)", "runtime claim");
  assertGateBefore(postBody(claim), "claimAgentRunsForRuntime({", "runtime claim");
  assertGateBefore(getBody(cron), "recordCronRun(", "agent worker cron");
  assertGateBefore(postBody(adminAgents), "readJson(req)", "admin agent creation");
  assertGateBefore(postBody(adminModels), "readJson(req)", "admin model creation");
});

test("read compatibility and in-flight completion remain available", async () => {
  const [agents, run, complete] = await Promise.all([
    read("app/api/v1/agents/route.ts"),
    read("app/api/v1/agent-runs/[id]/route.ts"),
    read("app/api/v1/runtime/agent-runs/[id]/complete/route.ts"),
  ]);

  assert.equal(getBody(agents).includes("hostedExecutionEnabled"), false);
  assert.equal(getBody(run).includes("hostedExecutionEnabled"), false);
  assert.equal(postBody(complete).includes("hostedExecutionEnabled"), false);
  assert.match(complete, /authenticateRuntimeRequest\(req\)/);
});

test("reported execution and model-management capabilities are masked while disabled", async () => {
  const [auth, orgGuard] = await Promise.all([
    read("lib/core/auth.ts"),
    read("lib/core/org-guard.ts"),
  ]);

  assert.match(auth, /canExecuteAgents:\s*hostedExecutionEnabled\(\)\s*&&/);
  assert.match(orgGuard, /const canManageHostedExecution = canManage && hostedExecutionEnabled\(\)/);
  assert.match(orgGuard, /canManageModels:\s*canManageHostedExecution/);
  assert.match(orgGuard, /canExecuteAgents:\s*canManageHostedExecution/);
});
