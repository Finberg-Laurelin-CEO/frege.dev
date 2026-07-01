#!/usr/bin/env node
// End-to-end local backend smoke test for the Frege agent-facing API surface.

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(rootDir, "packages/frege-cli/bin/frege-mcp.mjs");

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

async function readLocalConfig() {
  const configPath = path.join(os.homedir(), ".frege/mcp/config.json");
  if (!existsSync(configPath)) return {};
  return JSON.parse(await readFile(configPath, "utf8"));
}

function normalizeBaseUrl(value) {
  return (value || "http://localhost:3000").replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function redactKey(value) {
  if (!value) return "missing";
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

async function request(baseUrl, apiKey, route, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.auth === false ? {} : { Authorization: `Bearer ${apiKey}` }),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (options.expectedStatus && response.status !== options.expectedStatus) {
    throw new Error(`${route} returned ${response.status}, expected ${options.expectedStatus}: ${text}`);
  }
  if (!options.expectedStatus && !response.ok) {
    throw new Error(`${route} returned ${response.status}: ${text}`);
  }
  return { status: response.status, json };
}

async function step(name, fn) {
  process.stdout.write(`- ${name}... `);
  const output = await fn();
  console.log("ok");
  return output;
}

async function pollAgentRun(baseUrl, apiKey, runId, { attempts = 40, delayMs = 500 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const { json } = await request(baseUrl, apiKey, `/api/v1/agent-runs/${runId}`);
    const status = json.run?.status;
    if (status === "succeeded") return status;
    if (status === "failed" || status === "cancelled") {
      throw new Error(`agent run ${runId} ended as ${status}: ${json.run?.error ?? json.run?.last_error ?? "unknown"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`agent run ${runId} did not reach succeeded within ${attempts * delayMs}ms`);
}

function runMcpTool(baseUrl, apiKey, name, input = {}) {
  const message = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: input },
  };
  const result = spawnSync(process.execPath, [cliPath, "mcp", "serve"], {
    cwd: rootDir,
    input: `${JSON.stringify(message)}\n`,
    encoding: "utf8",
    env: {
      ...process.env,
      FREGE_BASE_URL: baseUrl,
      FREGE_API_KEY: apiKey,
    },
  });

  if (result.status !== 0) {
    throw new Error(`MCP ${name} exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  const line = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .find((entry) => entry.startsWith("{"));
  assert(line, `MCP ${name} produced no JSON response`);
  const messageOut = JSON.parse(line);
  if (messageOut.error) throw new Error(`MCP ${name} failed: ${messageOut.error.message}`);
  const text = messageOut.result?.content?.[0]?.text;
  assert(text, `MCP ${name} response missing content text`);
  return JSON.parse(text);
}

function runMcpList(baseUrl, apiKey) {
  const message = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
  const result = spawnSync(process.execPath, [cliPath, "mcp", "serve"], {
    cwd: rootDir,
    input: `${JSON.stringify(message)}\n`,
    encoding: "utf8",
    env: {
      ...process.env,
      FREGE_BASE_URL: baseUrl,
      FREGE_API_KEY: apiKey,
    },
  });
  if (result.status !== 0) {
    throw new Error(`MCP tools/list exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  const line = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .find((entry) => entry.startsWith("{"));
  assert(line, "MCP tools/list produced no JSON response");
  const messageOut = JSON.parse(line);
  if (messageOut.error) throw new Error(`MCP tools/list failed: ${messageOut.error.message}`);
  return messageOut.result.tools;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readLocalConfig();
  const baseUrl = normalizeBaseUrl(args["base-url"] || process.env.FREGE_BASE_URL || config.baseUrl || config.base_url);
  const apiKey = args["api-key"] || process.env.FREGE_API_KEY || config.apiKey || config.api_key;
  const includeAgentRun = Boolean(args["include-agent-run"]);
  const cronSecret = args["cron-secret"] || process.env.CRON_SECRET || config.cronSecret || config.cron_secret;

  if (!apiKey) {
    throw new Error("Missing Frege API key. Set FREGE_API_KEY or run `frege connect <base-url> --token <key>`.");
  }

  console.log(`Frege backend smoke -> ${baseUrl}`);
  console.log(`API key -> ${redactKey(apiKey)}`);

  await step("health endpoint", async () => {
    const { json } = await request(baseUrl, apiKey, "/api/v1/health", { auth: false });
    assertEqual(json.ok, true, "health ok");
  });

  await step("unauthenticated actor request is rejected", async () => {
    const { status } = await request(baseUrl, apiKey, "/api/v1/brain/status", {
      auth: false,
      expectedStatus: 401,
    });
    assertEqual(status, 401, "unauthenticated status");
  });

  const brainStatus = await step("actor status resolves org, role, key owner, capabilities", async () => {
    const { json } = await request(baseUrl, apiKey, "/api/v1/brain/status");
    assert(json.status?.organization?.slug, "missing organization slug");
    assert(json.status?.actor_type, "missing actor type");
    assert(Array.isArray(json.status?.allowed_trust_zones), "missing allowed trust zones");
    assert(json.status?.capabilities, "missing capabilities");
    return json.status;
  });

  await step("unsafe cross-origin POST is blocked before mutation", async () => {
    const { json } = await request(baseUrl, apiKey, "/api/v1/sessions", {
      method: "POST",
      expectedStatus: 403,
      headers: { Origin: "https://evil.example" },
      body: {
        client: "frege-smoke",
        title: "should not be created",
        trust_zone: "green",
      },
    });
    assertEqual(json.error, "forbidden_origin", "unsafe origin error");
  });

  await step("document search returns refund dummy corpus", async () => {
    const { json } = await request(baseUrl, apiKey, "/api/v1/documents/search?q=refund&limit=5");
    assert(Array.isArray(json.documents), "documents must be an array");
    assert(
      json.documents.some((document) => document.slug === "support-customer-refunds"),
      "expected support-customer-refunds in local dummy corpus",
    );
  });

  await step("context build returns gated refund packet", async () => {
    const { json } = await request(baseUrl, apiKey, "/api/v1/context/build", {
      method: "POST",
      body: { query: "refund policy", limit: 5 },
    });
    const context = json.context;
    assert(context?.id, "missing context id");
    assert(context.documents?.length > 0, "expected context documents");
    assert(context.token_estimate > 0, "expected nonzero token estimate");
    assert(
      context.documents.some((document) => document.slug === "support-customer-refunds"),
      "expected support-customer-refunds in context packet",
    );
    assert(context.documents.every((document) => document.trust_zone === "green"), "green actor received red document");
  });

  if (!brainStatus.allowed_trust_zones.includes("red")) {
    await step("restricted query reports denied count without leaking red content", async () => {
      const { json } = await request(baseUrl, apiKey, "/api/v1/context/build", {
        method: "POST",
        body: { query: "restricted red zone", limit: 8 },
      });
      const context = json.context;
      assert(context?.denied_count >= 1, "expected at least one denied restricted result");
      assert(
        (context.documents ?? []).every((document) => document.trust_zone !== "red"),
        "red document leaked into green-only context",
      );
      assert(
        !(JSON.stringify(context).toLowerCase().includes("red-zone-handling")),
        "restricted slug leaked into context packet",
      );
    });
  }

  let sessionId = null;
  if (brainStatus.capabilities?.canWriteSessions && brainStatus.capabilities?.canReadSessions) {
    const unique = `smoke-${Date.now()}`;
    const session = await step("session start redacts sensitive metadata", async () => {
      const { json } = await request(baseUrl, apiKey, "/api/v1/sessions", {
        method: "POST",
        body: {
          external_id: unique,
          client: "frege-smoke",
          title: "Frege smoke session",
          goal: "Verify session redaction and readback.",
          trust_zone: "green",
          metadata: {
            api_key: "frg_live_abcdef123456_secretvalue",
            nested: { authorization: "Bearer should-not-survive" },
          },
        },
      });
      assert(json.session?.id, "missing session id");
      assertEqual(json.session.metadata.api_key, "[redacted]", "metadata api_key redaction");
      assertEqual(json.session.metadata.nested.authorization, "[redacted]", "metadata authorization redaction");
      return json.session;
    });
    sessionId = session.id;

    const event = await step("session event body and payload are redacted", async () => {
      const { json } = await request(baseUrl, apiKey, `/api/v1/sessions/${sessionId}/events`, {
        method: "POST",
        body: {
          event_type: "note",
          body_md: "password=hunter2 authorization: Bearer should-not-survive api_key=abc123",
          payload: {
            api_key: "abc123",
            nested: { token: "token-123", safe: "kept" },
          },
          trust_zone: "green",
        },
      });
      assert(json.event?.id, "missing event id");
      assert(!json.event.body_md.includes("hunter2"), "password leaked in event body");
      assert(!json.event.body_md.includes("should-not-survive"), "authorization bearer leaked in event body");
      assertEqual(json.event.payload.api_key, "[redacted]", "payload api_key redaction");
      assertEqual(json.event.payload.nested.token, "[redacted]", "payload token redaction");
      assertEqual(json.event.payload.nested.safe, "kept", "safe payload field should remain");
      return json.event;
    });

    await step("session readback includes redacted event", async () => {
      const { json } = await request(baseUrl, apiKey, `/api/v1/sessions/${sessionId}`);
      assertEqual(json.session.id, sessionId, "session id readback");
      const stored = json.events.find((candidate) => candidate.id === event.id);
      assert(stored, "stored event missing from session readback");
      assert(!JSON.stringify(stored).includes("hunter2"), "secret leaked in session readback");
      assert(!JSON.stringify(stored).includes("should-not-survive"), "bearer leaked in session readback");
    });
  } else {
    console.log("- session redaction smoke... skipped (key cannot read/write sessions)");
  }

  if (brainStatus.capabilities?.canProposeMemory) {
    await step("memory proposal can be created from session context", async () => {
      const slug = `smoke-memory-${Date.now()}`;
      const { json } = await request(baseUrl, apiKey, "/api/v1/brain/proposals", {
        method: "POST",
        body: {
          proposal_type: "page_create",
          slug,
          title: "Smoke Memory Proposal",
          body_md: "Smoke proposal body. api_key=abc123",
          summary: "Smoke proposal created by local backend smoke test.",
          trust_zone: "green",
          session_id: sessionId ?? undefined,
          metadata: { token: "token-123" },
        },
      });
      assertEqual(json.proposal.slug, slug, "proposal slug");
      assertEqual(json.proposal.status, "pending", "proposal status");
    });
  } else {
    console.log("- memory proposal smoke... skipped (key cannot propose memory)");
  }

  await step("MCP tools list includes context and agent tools", async () => {
    const tools = runMcpList(baseUrl, apiKey);
    const names = tools.map((tool) => tool.name);
    for (const expected of ["frege_build_context", "frege_list_agents", "frege_run_agent", "frege_get_agent_run"]) {
      assert(names.includes(expected), `missing MCP tool ${expected}`);
    }
  });

  await step("MCP frege_build_context calls hosted API", async () => {
    const json = runMcpTool(baseUrl, apiKey, "frege_build_context", { query: "refund policy", limit: 3 });
    assert(json.context?.id, "missing MCP context id");
    assert(json.context.documents?.length > 0, "expected MCP context documents");
  });

  const agents = await step("agent list endpoint is reachable", async () => {
    const { json } = await request(baseUrl, apiKey, "/api/v1/agents");
    assert(Array.isArray(json.agents), "agents must be an array");
    return json.agents;
  });

  if (includeAgentRun) {
    if (!brainStatus.capabilities?.canExecuteAgents) {
      console.log("- hosted agent queue smoke... skipped (key cannot execute agents)");
    } else if (!agents.length) {
      console.log("- hosted agent queue smoke... skipped (no active agents)");
    } else {
      const runId = await step("hosted agent run queues and reads back", async () => {
        const agent = agents[0];
        const { json } = await request(baseUrl, apiKey, "/api/v1/agents", {
          method: "POST",
          body: {
            agent_slug: agent.slug,
            input_md: "Smoke-test queued agent run. Do not execute external actions.",
            context_query: "refund policy",
            trust_zone: "green",
            session_id: sessionId ?? undefined,
            metadata: { smoke: true, script: "smoke-backend" },
          },
        });
        assert(json.run?.id, "missing agent run id");
        assertEqual(json.run.status, "queued", "agent run status");
        const readback = await request(baseUrl, apiKey, `/api/v1/agent-runs/${json.run.id}`);
        assertEqual(readback.json.run.id, json.run.id, "agent run readback id");
        return json.run.id;
      });

      if (!cronSecret) {
        console.log("- hosted agent run executes via cron worker... skipped (set CRON_SECRET to enable)");
      } else {
        await step("hosted agent run executes via cron worker and reaches succeeded", async () => {
          const worker = await request(baseUrl, apiKey, "/api/cron/agent-worker", {
            auth: false,
            headers: { Authorization: `Bearer ${cronSecret}` },
            expectedStatus: 200,
          });
          assert(worker.json.ok !== false, `cron worker returned not-ok: ${JSON.stringify(worker.json)}`);
          const finalStatus = await pollAgentRun(baseUrl, apiKey, runId);
          assertEqual(finalStatus, "succeeded", "agent run terminal status");
        });
      }
    }
  }

  console.log("Frege backend smoke passed.");
}

main().catch((err) => {
  console.error("Frege backend smoke failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
