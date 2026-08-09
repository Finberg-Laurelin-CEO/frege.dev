#!/usr/bin/env node
import assert from "node:assert/strict";

const protocolVersion = "2026-07-28";
const baseUrl = process.env.FREGE_MCP_BASE_URL ?? "https://frege.dev";
const apiKey = process.env.FREGE_API_KEY;
if (!apiKey) {
  console.error("FREGE_API_KEY is required; provide it through a secure environment, not an argument.");
  process.exit(1);
}

const endpoint = new URL("/mcp", baseUrl);
if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) {
  throw new Error("Refusing to send an API key over non-HTTPS transport");
}
const localProxyHeaders = endpoint.protocol === "http:"
  ? { "X-Forwarded-Proto": "https" }
  : {};

const meta = {
  "io.modelcontextprotocol/protocolVersion": protocolVersion,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "frege-mcp-canary", version: "1" },
};

function message(method, id, params = {}) {
  return { jsonrpc: "2.0", id, method, params: { _meta: meta, ...params } };
}

async function post(method, id, params = {}, options = {}) {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": protocolVersion,
    "Mcp-Method": method,
    ...localProxyHeaders,
    ...(method === "tools/call" ? { "Mcp-Name": params.name } : {}),
    ...(options.authorized === false ? {} : { Authorization: `Bearer ${apiKey}` }),
    ...(options.headers ?? {}),
  };
  return fetch(endpoint, {
    method: "POST",
    redirect: "manual",
    headers,
    body: JSON.stringify(options.body ?? message(method, id, params)),
  });
}

function assertSecurityHeaders(response) {
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.equal(response.headers.get("mcp-session-id"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("location"), null);
}

const getResponse = await fetch(endpoint, {
  method: "GET",
  redirect: "manual",
  headers: localProxyHeaders,
});
assert.equal(getResponse.status, 405);
assertSecurityHeaders(getResponse);

const unauthorized = await post("server/discover", "unauthorized", {}, { authorized: false });
assert.equal(unauthorized.status, 401);
assertSecurityHeaders(unauthorized);

const badOrigin = await post("server/discover", "origin", {}, {
  authorized: false,
  headers: { Origin: "https://invalid.example" },
});
assert.equal(badOrigin.status, 403);
assertSecurityHeaders(badOrigin);

const discoveryResponse = await post("server/discover", "discovery");
assert.equal(discoveryResponse.status, 200);
assertSecurityHeaders(discoveryResponse);
assert.match(discoveryResponse.headers.get("content-type") ?? "", /^application\/json/i);
const discovery = await discoveryResponse.json();
assert.deepEqual(discovery.result?.supportedVersions, [protocolVersion]);
assert.equal(discovery.result?.capabilities?.tools?.listChanged, false);

const listResponse = await post("tools/list", "list");
assert.equal(listResponse.status, 200);
assertSecurityHeaders(listResponse);
const list = await listResponse.json();
const tools = list.result?.tools ?? [];
const names = new Set(tools.map((tool) => tool.name));
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
for (const name of forbidden) assert.equal(names.has(name), false, `${name} must not be hosted`);
for (const tool of tools) {
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.equal(tool.annotations?.idempotentHint, true);
  assert.equal(tool.inputSchema?.additionalProperties, false);
}

const statusResponse = await post("tools/call", "status", {
  name: "frege_status",
  arguments: {},
});
assert.equal(statusResponse.status, 200);
assertSecurityHeaders(statusResponse);
const statusEnvelope = await statusResponse.json();
assert.notEqual(statusEnvelope.result?.isError, true);
const statusText = statusEnvelope.result?.content?.[0]?.text ?? "";
assert.doesNotMatch(statusText, /owner_user|owner.*email|"id"/i);

const sessionId = process.env.FREGE_MCP_CANARY_SESSION_ID;
if (sessionId) {
  assert.equal(names.has("frege_get_session"), true, "canary key lacks session-read capability");
  const sessionResponse = await post("tools/call", "session", {
    name: "frege_get_session",
    arguments: { session_id: sessionId },
  });
  assert.equal(sessionResponse.status, 200);
  assertSecurityHeaders(sessionResponse);
  const sessionEnvelope = await sessionResponse.json();
  assert.notEqual(sessionEnvelope.result?.isError, true);
}

const legacyResponse = await post("initialize", "legacy", {}, {
  headers: { "MCP-Protocol-Version": "2025-11-25" },
  body: {
    jsonrpc: "2.0",
    id: "legacy",
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "legacy-canary", version: "1" },
    },
  },
});
assert.notEqual(legacyResponse.status, 200);
assertSecurityHeaders(legacyResponse);

console.log(JSON.stringify({
  ok: true,
  endpoint: endpoint.origin + endpoint.pathname,
  protocolVersion,
  toolCount: tools.length,
  sessionReadChecked: Boolean(sessionId),
}));
