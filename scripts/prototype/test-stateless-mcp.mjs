#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod4";

const root = process.cwd();
const protocol = await import(
  pathToFileURL(path.join(root, "lib/mcp/protocol.ts")).href
);

const {
  MCP_MAX_REQUEST_BYTES,
  MCP_PROTOCOL_VERSION,
  createHostedMcpHandler,
  finalizeMcpResponse,
  readBoundedMcpJson,
  secureMcpResponse,
} = protocol;

const meta = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "frege-test", version: "1" },
};
const authInfo = {
  token: "nonsecret-test-marker",
  clientId: "test-client",
  scopes: ["frege:read"],
};

const handler = createHostedMcpHandler(() => [
  {
    name: "frege_test_read",
    description: "Read a deterministic test value.",
    inputSchema: z.object({ value: z.string().min(1).max(16) }).strict(),
    execute: async (input) => ({ echoed: input.value }),
  },
]);

function request(method, params, options = {}) {
  const headers = {
    Host: "frege.dev",
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Mcp-Method": method,
    ...(method === "tools/call" ? { "Mcp-Name": params.name } : {}),
    ...(options.headers ?? {}),
  };
  const body = options.body ?? JSON.stringify({ jsonrpc: "2.0", id: options.id ?? method, method, params });
  return new Request("https://frege.dev/mcp", { method: "POST", headers, body });
}

async function dispatch(req) {
  const parsed = await readBoundedMcpJson(req);
  assert.equal(parsed.ok, true);
  const response = await handler.fetch(req, { authInfo, parsedBody: parsed.value });
  return secureMcpResponse(response);
}

async function json(response) {
  return JSON.parse(await response.text());
}

test("modern discovery is stateless and advertises only the 2026 protocol", async () => {
  const response = await dispatch(request("server/discover", { _meta: meta }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-session-id"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await json(response);
  assert.deepEqual(body.result.supportedVersions, [MCP_PROTOCOL_VERSION]);
  assert.equal(body.result.capabilities.tools.listChanged, false);
  assert.equal(body.result.resultType, "complete");
  assert.equal(body.result._meta["io.modelcontextprotocol/serverInfo"].name, "frege-hosted");
});

test("tools/list publishes strict read-only and idempotent schemas", async () => {
  const response = await dispatch(request("tools/list", { _meta: meta }));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.result.tools.length, 1);
  const listed = body.result.tools[0];
  assert.equal(listed.name, "frege_test_read");
  assert.equal(listed.inputSchema.additionalProperties, false);
  assert.deepEqual(listed.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
});

test("tools/call validates input and returns bounded JSON text", async () => {
  const response = await dispatch(
    request("tools/call", { name: "frege_test_read", arguments: { value: "ok" }, _meta: meta }),
  );
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.result.resultType, "complete");
  assert.deepEqual(JSON.parse(body.result.content[0].text), { echoed: "ok" });

  const invalid = await dispatch(
    request("tools/call", {
      name: "frege_test_read",
      arguments: { value: "ok", extra: true },
      _meta: meta,
    }),
  );
  const invalidBody = await json(invalid);
  assert.equal(invalidBody.result.isError, true);
  assert.match(invalidBody.result.content[0].text, /Input validation error/);
});

test("legacy initialize and modern header mismatches fail closed", async () => {
  const legacy = request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "legacy", version: "1" },
  }, { headers: { "MCP-Protocol-Version": "2025-11-25" } });
  const parsedLegacy = await readBoundedMcpJson(legacy);
  assert.equal(parsedLegacy.ok, true);
  const legacyResponse = await handler.fetch(legacy, { authInfo, parsedBody: parsedLegacy.value });
  assert.equal(legacyResponse.status, 400);
  const legacyBody = await json(legacyResponse);
  assert.equal(legacyBody.error.code, -32022);

  const mismatch = request("tools/list", { _meta: meta }, { headers: { "Mcp-Method": "tools/call" } });
  const parsedMismatch = await readBoundedMcpJson(mismatch);
  assert.equal(parsedMismatch.ok, true);
  const mismatchResponse = await handler.fetch(mismatch, { authInfo, parsedBody: parsedMismatch.value });
  assert.equal(mismatchResponse.status, 400);
  const mismatchBody = await json(mismatchResponse);
  assert.equal(mismatchBody.error.code, -32020);
});

test("bounded parser rejects batches, notifications, bad media, encoding, and oversize bodies", async () => {
  const batch = request("tools/list", { _meta: meta }, { body: "[]" });
  let parsed = await readBoundedMcpJson(batch);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);

  const notification = request("tools/list", { _meta: meta }, {
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", params: { _meta: meta } }),
  });
  parsed = await readBoundedMcpJson(notification);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);

  const subscription = request("subscriptions/listen", { notifications: {}, _meta: meta });
  parsed = await readBoundedMcpJson(subscription);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 404);

  const invalidVersion = request("tools/list", { _meta: meta }, {
    body: JSON.stringify({ jsonrpc: "1.0", id: 1, method: "tools/list", params: { _meta: meta } }),
  });
  parsed = await readBoundedMcpJson(invalidVersion);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);

  const invalidId = request("tools/list", { _meta: meta }, {
    body: JSON.stringify({ jsonrpc: "2.0", id: {}, method: "tools/list", params: { _meta: meta } }),
  });
  parsed = await readBoundedMcpJson(invalidId);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);

  const missingAccept = request("tools/list", { _meta: meta }, { headers: { Accept: "" } });
  parsed = await readBoundedMcpJson(missingAccept);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 406);

  const sessionHeader = request("tools/list", { _meta: meta }, {
    headers: { "Mcp-Session-Id": "legacy-session" },
  });
  parsed = await readBoundedMcpJson(sessionHeader);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);

  const rejectedStream = request("tools/list", { _meta: meta }, {
    headers: { Accept: "application/json, text/event-stream;q=0" },
  });
  parsed = await readBoundedMcpJson(rejectedStream);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 406);

  const text = request("tools/list", { _meta: meta }, { headers: { "Content-Type": "text/plain" } });
  parsed = await readBoundedMcpJson(text);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 415);

  const encoded = request("tools/list", { _meta: meta }, { headers: { "Content-Encoding": "gzip" } });
  parsed = await readBoundedMcpJson(encoded);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 415);

  const oversized = request("tools/list", { _meta: meta }, {
    body: JSON.stringify({ value: "x".repeat(MCP_MAX_REQUEST_BYTES + 1) }),
  });
  parsed = await readBoundedMcpJson(oversized);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 413);

  const brokenBody = new ReadableStream({
    pull(controller) {
      controller.error(new Error("synthetic read failure"));
    },
  });
  const broken = new Request("https://frege.dev/mcp", {
    method: "POST",
    headers: {
      Host: "frege.dev",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: brokenBody,
    duplex: "half",
  });
  parsed = await readBoundedMcpJson(broken);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);
});

test("final response gate rejects streaming and oversized SDK responses", async () => {
  const streaming = await finalizeMcpResponse(
    new Response("event: message\n\ndata: {}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }),
  );
  assert.equal(streaming.status, 500);
  assert.match(await streaming.text(), /Invalid MCP response/);

  const oversized = await finalizeMcpResponse(
    Response.json({ value: "x".repeat(MCP_MAX_REQUEST_BYTES) }),
    1024,
  );
  assert.equal(oversized.status, 500);
  assert.match(await oversized.text(), /MCP response too large/);
});

test("security wrapper removes session and CORS state", async () => {
  const response = secureMcpResponse(
    new Response("{}", {
      headers: {
        "Mcp-Session-Id": "must-not-survive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization",
        "Set-Cookie": "session=must-not-survive",
        Location: "https://invalid.example",
      },
    }),
  );
  assert.equal(response.headers.get("mcp-session-id"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-headers"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("hosted production source excludes writes, metering, and Graphify execution", async () => {
  const source = await readFile(path.join(root, "lib/core/mcp-http-tools.ts"), "utf8");
  const registered = [...source.matchAll(/\btool\(\s*\n?\s*"(frege_[a-z_]+)"/g)].map((match) => match[1]);
  const allowed = [
    "frege_status",
    "frege_brain_status",
    "frege_list_sources",
    "frege_search_pages",
    "frege_get_page",
    "frege_list_vault",
    "frege_page_links",
    "frege_traverse",
    "frege_find_connections",
    "frege_list_documents",
    "frege_search_documents",
    "frege_read_document",
    "frege_list_skills",
    "frege_get_skill",
    "frege_search_sessions",
    "frege_get_session",
    "frege_audit_events",
  ];
  assert.deepEqual([...registered].sort(), [...allowed].sort());
  const forbidden = [
    "frege_add_source_proposal",
    "frege_write_page_proposal",
    "frege_propose_memory_from_session",
    "frege_start_session",
    "frege_append_session_event",
    "frege_build_context",
    "frege_create_document",
    "frege_propose_revision",
    "frege_code_graph_query",
    "frege_code_context",
  ];
  for (const name of forbidden) assert.equal(registered.includes(name), false, `${name} must not register`);
  assert.doesNotMatch(source, /graphify-local|child_process|spawnSync|runGraphify|FREGE_CODE_GRAPH/);
  assert.match(source, /!\/\[%_\]\/.test\(value\)/);
  assert.ok(registered.includes("frege_search_sessions"));
  assert.ok(registered.includes("frege_get_session"));
});


test("gateway source is bearer-only, feature-gated, rate-limited, and non-redirecting", async () => {
  const gateway = await readFile(path.join(root, "lib/core/mcp-http.ts"), "utf8");
  const middleware = await readFile(path.join(root, "middleware.ts"), "utf8");
  const nextConfig = await readFile(path.join(root, "next.config.ts"), "utf8");
  assert.match(gateway, /FREGE_STATELESS_MCP_ENABLED === "true"/);
  assert.match(gateway, /FREGE_ADMIN_ONLY !== "true"/);
  assert.match(gateway, /cookie_auth_not_supported/);
  assert.match(gateway, /authenticatePrototypeRequest\(req\)/);
  assert.match(gateway, /assertActiveOrg\(auth\)/);
  assert.match(gateway, /mcp_http_auth/);
  assert.match(gateway, /mcp_http_key/);
  assert.match(gateway, /hostHeaderValidationResponse/);
  assert.match(gateway, /originValidationResponse/);
  assert.match(middleware, /reqPath === "\/mcp"/);
  assert.match(middleware, /\{ error: "not_found" \}/);
  assert.match(middleware, /"Cache-Control": "private, no-store"/);
  assert.match(nextConfig, /skipTrailingSlashRedirect: true/);
});

test("brain status counts are capability and trust-zone scoped", async () => {
  const brain = await readFile(path.join(root, "lib/core/brain.ts"), "utf8");
  const start = brain.indexOf("export async function brainStatus");
  const end = brain.indexOf("export async function listBrainSources", start);
  const status = brain.slice(start, end);
  assert.match(status, /trust_zone = any\(\$\{visibleTrustZones\}::text\[\]\)/);
  assert.match(status, /actor\.capabilities\.canReadSessions/);
  assert.match(status, /actor\.capabilities\.canReviewMemoryProposals/);
});

test.after(async () => {
  await handler.close();
});
