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
  MCP_MAX_HOST_HEADER_BYTES,
  MCP_MAX_ORIGIN_HEADER_BYTES,
  MCP_MAX_REQUEST_BYTES,
  MCP_MAX_REQUEST_ID_BYTES,
  MCP_MAX_RESULT_BYTES,
  MCP_PROTOCOL_VERSION,
  createHostedMcpHandler,
  finalizeMcpResponse,
  oversizedMcpAuthorityHeaderResponse,
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

  const subscription = request(
    "subscriptions/listen",
    { notifications: {}, _meta: meta },
    { id: "subscription-42" },
  );
  parsed = await readBoundedMcpJson(subscription);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 404);
  assert.equal((await json(parsed.response)).id, "subscription-42");

  const unknown = request("resources/list", { _meta: meta }, { id: 77 });
  parsed = await readBoundedMcpJson(unknown);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 404);
  assert.equal((await json(parsed.response)).id, 77);

  const invalidVersion = request("tools/list", { _meta: meta }, {
    body: JSON.stringify({ jsonrpc: "1.0", id: 1, method: "tools/list", params: { _meta: meta } }),
  });
  parsed = await readBoundedMcpJson(invalidVersion);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);
  assert.equal((await json(parsed.response)).id, 1);

  const invalidId = request("tools/list", { _meta: meta }, {
    body: JSON.stringify({ jsonrpc: "2.0", id: {}, method: "tools/list", params: { _meta: meta } }),
  });
  parsed = await readBoundedMcpJson(invalidId);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);
  assert.equal((await json(parsed.response)).id, null);

  const maximumStringId = "é".repeat(MCP_MAX_REQUEST_ID_BYTES / 2);
  const maximumIdRequest = request("tools/list", { _meta: meta }, { id: maximumStringId });
  parsed = await readBoundedMcpJson(maximumIdRequest);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.id, maximumStringId);

  const oversizedId = "x".repeat(MCP_MAX_REQUEST_ID_BYTES + 1);
  const oversizedIdRequest = request("tools/list", { _meta: meta }, { id: oversizedId });
  parsed = await readBoundedMcpJson(oversizedIdRequest);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);
  let invalidIdBody = await json(parsed.response);
  assert.equal(invalidIdBody.id, null);
  assert.ok(Buffer.byteLength(JSON.stringify(invalidIdBody)) <= MCP_MAX_RESULT_BYTES);

  const nonFiniteId = request("tools/list", { _meta: meta }, {
    body: `{"jsonrpc":"2.0","id":1e400,"method":"tools/list","params":{"_meta":${JSON.stringify(meta)}}}`,
  });
  parsed = await readBoundedMcpJson(nonFiniteId);
  assert.equal(parsed.ok, false);
  invalidIdBody = await json(parsed.response);
  assert.equal(invalidIdBody.id, null);

  const unsafeIntegerId = request("tools/list", { _meta: meta }, {
    body: `{"jsonrpc":"2.0","id":9007199254740992,"method":"tools/list","params":{"_meta":${JSON.stringify(meta)}}}`,
  });
  parsed = await readBoundedMcpJson(unsafeIntegerId);
  assert.equal(parsed.ok, false);
  invalidIdBody = await json(parsed.response);
  assert.equal(invalidIdBody.id, null);

  for (const numericIdSource of ["1e-400", "9007199254740991.1", "1.0", "1e3", "-0"]) {
    const lossyNumericId = request("tools/list", { _meta: meta }, {
      body: `{"jsonrpc":"2.0","id":${numericIdSource},"method":"tools/list","params":{"_meta":${JSON.stringify(meta)}}}`,
    });
    parsed = await readBoundedMcpJson(lossyNumericId);
    assert.equal(parsed.ok, false, `${numericIdSource} must not round into an accepted ID`);
    invalidIdBody = await json(parsed.response);
    assert.equal(invalidIdBody.id, null);
  }

  for (const numericIdSource of ["-9007199254740991", "0", "9007199254740991"]) {
    const canonicalNumericId = request("tools/list", { _meta: meta }, {
      body: `{"jsonrpc":"2.0","id":${numericIdSource},"method":"tools/list","params":{"_meta":${JSON.stringify(meta)}}}`,
    });
    parsed = await readBoundedMcpJson(canonicalNumericId);
    assert.equal(parsed.ok, true, `${numericIdSource} must remain an accepted exact ID`);
    assert.equal(parsed.value.id, Number(numericIdSource));
  }

  for (const duplicateIdBody of [
    `{"jsonrpc":"2.0","id":1,"id":2,"method":"tools/list","params":{"_meta":${JSON.stringify(meta)}}}`,
    `{"jsonrpc":"2.0","id":"first","\\u0069d":"second","method":"tools/list","params":{"_meta":${JSON.stringify(meta)}}}`,
  ]) {
    parsed = await readBoundedMcpJson(
      request("tools/list", { _meta: meta }, { body: duplicateIdBody }),
    );
    assert.equal(parsed.ok, false);
    invalidIdBody = await json(parsed.response);
    assert.equal(invalidIdBody.id, null);
  }

  for (const duplicateCoreBody of [
    `{"jsonrpc":"2.0","jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":${JSON.stringify(meta)}}}`,
    `{"jsonrpc":"2.0","id":1,"method":"tools/list","method":"tools/list","params":{"_meta":${JSON.stringify(meta)}}}`,
    `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":${JSON.stringify(meta)}},"params":{"_meta":${JSON.stringify(meta)}}}`,
  ]) {
    parsed = await readBoundedMcpJson(
      request("tools/list", { _meta: meta }, { body: duplicateCoreBody }),
    );
    assert.equal(parsed.ok, false);
    invalidIdBody = await json(parsed.response);
    assert.equal(invalidIdBody.id, 1);
  }

  const oversizedIdAndBadVersion = request("tools/list", { _meta: meta }, {
    body: JSON.stringify({ jsonrpc: "1.0", id: oversizedId, method: "tools/list", params: { _meta: meta } }),
  });
  parsed = await readBoundedMcpJson(oversizedIdAndBadVersion);
  assert.equal(parsed.ok, false);
  invalidIdBody = await json(parsed.response);
  assert.equal(invalidIdBody.id, null);
  assert.ok(Buffer.byteLength(JSON.stringify(invalidIdBody)) <= MCP_MAX_RESULT_BYTES);

  const capSizedId = "x".repeat(MCP_MAX_RESULT_BYTES + 1);
  const capSizedIdRequest = request("tools/list", { _meta: meta }, { id: capSizedId });
  parsed = await readBoundedMcpJson(capSizedIdRequest);
  assert.equal(parsed.ok, false);
  invalidIdBody = await json(parsed.response);
  assert.equal(invalidIdBody.id, null);
  assert.ok(Buffer.byteLength(JSON.stringify(invalidIdBody)) <= MCP_MAX_RESULT_BYTES);

  const missingAccept = request("tools/list", { _meta: meta }, { headers: { Accept: "" } });
  parsed = await readBoundedMcpJson(missingAccept);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 406);

  const missingProtocolVersion = request("tools/list", { _meta: meta }, {
    headers: { "MCP-Protocol-Version": "" },
  });
  parsed = await readBoundedMcpJson(missingProtocolVersion);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);

  const parameterizedJson = request("tools/list", { _meta: meta }, {
    headers: { "Content-Type": 'application/json; profile="mcp"' },
  });
  parsed = await readBoundedMcpJson(parameterizedJson);
  assert.equal(parsed.ok, true);

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

  const spacedZeroQuality = request("tools/list", { _meta: meta }, {
    headers: { Accept: "application/json, text/event-stream; q = 0" },
  });
  parsed = await readBoundedMcpJson(spacedZeroQuality);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 406);

  const invalidQuality = request("tools/list", { _meta: meta }, {
    headers: { Accept: "application/json, text/event-stream;q=1.1" },
  });
  parsed = await readBoundedMcpJson(invalidQuality);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 406);

  const validQuality = request("tools/list", { _meta: meta }, {
    headers: { Accept: "application/json;q=0.5, text/event-stream;q=1.000" },
  });
  parsed = await readBoundedMcpJson(validQuality);
  assert.equal(parsed.ok, true);

  const quotedMasquerade = request("tools/list", { _meta: meta }, {
    headers: { Accept: 'text/plain;note=",application/json,text/event-stream,"' },
  });
  parsed = await readBoundedMcpJson(quotedMasquerade);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 406);

  const validQuotedParameters = request("tools/list", { _meta: meta }, {
    headers: {
      Accept: 'application/json;note="a,b;q=0", text/event-stream;note="x;y,\\"z"',
    },
  });
  parsed = await readBoundedMcpJson(validQuotedParameters);
  assert.equal(parsed.ok, true);

  const validEmptyListMembers = request("tools/list", { _meta: meta }, {
    headers: { Accept: ", \t, application/json,, text/event-stream, " },
  });
  parsed = await readBoundedMcpJson(validEmptyListMembers);
  assert.equal(parsed.ok, true);

  for (const accept of [
    'application/json;q="1", text/event-stream',
    "application/json;q=1;q=0, text/event-stream",
    'application/json;note="unterminated, text/event-stream',
    "\u00a0, application/json, text/event-stream",
    `application/json;note="${String.fromCharCode(0x80)}", text/event-stream`,
    `application/json;note="\\${String.fromCharCode(0x80)}", text/event-stream`,
    `application/json;note="${String.fromCharCode(0xa0)}", text/event-stream`,
    `application/json;note="${String.fromCharCode(0xff)}", text/event-stream`,
    `application/json, text/event-stream;note="${"x".repeat(MCP_MAX_REQUEST_BYTES)}"`,
  ]) {
    parsed = await readBoundedMcpJson(
      request("tools/list", { _meta: meta }, { headers: { Accept: accept } }),
    );
    assert.equal(parsed.ok, false, `invalid Accept must fail closed: ${accept.slice(0, 80)}`);
    assert.equal(parsed.response.status, 406);
  }

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
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: brokenBody,
    duplex: "half",
  });
  parsed = await readBoundedMcpJson(broken);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);
});

test("final response gate rejects streaming and oversized SDK responses with the known ID", async () => {
  const streaming = await finalizeMcpResponse(
    new Response("event: message\n\ndata: {}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }),
    { requestId: "stream-id-7" },
  );
  assert.equal(streaming.status, 500);
  const streamingBody = await json(streaming);
  assert.match(streamingBody.error.message, /Invalid MCP response/);
  assert.equal(streamingBody.id, "stream-id-7");

  const oversized = await finalizeMcpResponse(
    Response.json({ value: "x".repeat(MCP_MAX_REQUEST_BYTES) }),
    { maxBytes: 1024, requestId: 808 },
  );
  assert.equal(oversized.status, 500);
  const oversizedBody = await json(oversized);
  assert.match(oversizedBody.error.message, /MCP response too large/);
  assert.equal(oversizedBody.id, 808);

  const capHandler = createHostedMcpHandler(() => [
    {
      name: "frege_near_cap",
      description: "Return a deterministic near-cap value.",
      inputSchema: z.object({}).strict(),
      execute: async () => ({ value: "x".repeat(MCP_MAX_RESULT_BYTES - 100) }),
    },
  ]);
  const capRequest = request(
    "tools/call",
    { name: "frege_near_cap", arguments: {}, _meta: meta },
    { id: "cap-id-88" },
  );
  const parsed = await readBoundedMcpJson(capRequest);
  assert.equal(parsed.ok, true);
  const sdkResponse = await capHandler.fetch(capRequest, { authInfo, parsedBody: parsed.value });
  const bounded = await finalizeMcpResponse(sdkResponse, { requestId: parsed.value.id });
  assert.equal(bounded.status, 500);
  const boundedBody = await json(bounded);
  assert.equal(boundedBody.error.code, -32603);
  assert.equal(boundedBody.id, "cap-id-88");
  assert.ok(Buffer.byteLength(JSON.stringify(boundedBody)) <= MCP_MAX_RESULT_BYTES);

  const wrongId = await finalizeMcpResponse(
    Response.json({ jsonrpc: "2.0", id: "sdk-wrong", result: {} }),
    { requestId: "expected-id" },
  );
  assert.equal(wrongId.status, 500);
  const wrongIdBody = await json(wrongId);
  assert.equal(wrongIdBody.error.code, -32603);
  assert.equal(wrongIdBody.id, "expected-id");

  for (const [numericIdSource, expectedId] of [["1e-400", 0], ["1e0", 1]]) {
    const lossyResponseId = await finalizeMcpResponse(
      new Response(`{"jsonrpc":"2.0","id":${numericIdSource},"result":{}}`, {
        headers: { "Content-Type": "application/json" },
      }),
      { requestId: expectedId },
    );
    assert.equal(lossyResponseId.status, 500);
    const lossyResponseBody = await json(lossyResponseId);
    assert.equal(lossyResponseBody.error.code, -32603);
    assert.equal(lossyResponseBody.id, expectedId);
  }

  const duplicateResponseId = await finalizeMcpResponse(
    new Response('{"jsonrpc":"2.0","id":"first","id":"expected-id","result":{}}', {
      headers: { "Content-Type": "application/json" },
    }),
    { requestId: "expected-id" },
  );
  assert.equal(duplicateResponseId.status, 500);
  assert.equal((await json(duplicateResponseId)).id, "expected-id");

  const malformedErrorBodies = [
    '{"jsonrpc":"2.0","id":"expected-id","error":null}',
    '{"jsonrpc":"2.0","id":"expected-id","error":[]}',
    '{"jsonrpc":"2.0","id":"expected-id","error":{"code":1.5,"message":"bad"}}',
    '{"jsonrpc":"2.0","id":"expected-id","error":{"code":1e0,"message":"bad"}}',
    '{"jsonrpc":"2.0","id":"expected-id","error":{"code":"1","message":"bad"}}',
    '{"jsonrpc":"2.0","id":"expected-id","error":{"code":1}}',
    '{"jsonrpc":"2.0","id":"expected-id","error":{"message":"bad"}}',
    '{"jsonrpc":"2.0","id":"expected-id","error":{"code":1,"code":2,"message":"bad"}}',
    '{"jsonrpc":"2.0","id":"expected-id","error":{"code":1,"message":"one","message":"two"}}',
    '{"jsonrpc":"2.0","id":"expected-id","error":{"code":1,"message":"bad"},"error":{"code":2,"message":"worse"}}',
    '{"jsonrpc":"2.0","id":"expected-id","result":{},"result":{}}',
  ];
  for (const body of malformedErrorBodies) {
    const rejected = await finalizeMcpResponse(
      new Response(body, { headers: { "Content-Type": "application/json" } }),
      { requestId: "expected-id" },
    );
    assert.equal(rejected.status, 500);
    const rejectedBody = await json(rejected);
    assert.equal(rejectedBody.error.code, -32603);
    assert.equal(rejectedBody.id, "expected-id");
  }

  const validError = await finalizeMcpResponse(
    Response.json({
      jsonrpc: "2.0",
      id: "expected-id",
      error: { code: -32601, message: "Method not found", data: { safe: true } },
    }, { status: 404 }),
    { requestId: "expected-id" },
  );
  assert.equal(validError.status, 404);
  assert.equal((await json(validError)).error.code, -32601);

  const malformedEnvelope = await finalizeMcpResponse(
    Response.json({ jsonrpc: "1.0", id: "expected-id", result: {}, error: {} }),
    { requestId: "expected-id" },
  );
  assert.equal(malformedEnvelope.status, 500);
  assert.equal((await json(malformedEnvelope)).id, "expected-id");

  const untrustedLargeId = "z".repeat(MCP_MAX_RESULT_BYTES);
  const boundedUntrustedId = await finalizeMcpResponse(
    Response.json({ value: "x".repeat(MCP_MAX_RESULT_BYTES) }),
    { requestId: untrustedLargeId },
  );
  assert.equal(boundedUntrustedId.status, 500);
  const boundedUntrustedBody = await json(boundedUntrustedId);
  assert.equal(boundedUntrustedBody.id, null);
  assert.ok(Buffer.byteLength(JSON.stringify(boundedUntrustedBody)) <= MCP_MAX_RESULT_BYTES);
});

test("oversized authority headers produce bounded static errors before SDK reflection", async () => {
  const cases = [
    { Host: "h".repeat(MCP_MAX_RESULT_BYTES + 1024) },
    { Host: "frege.dev", "X-Forwarded-Host": "h".repeat(MCP_MAX_HOST_HEADER_BYTES + 1) },
    { Host: "frege.dev", Origin: "o".repeat(MCP_MAX_RESULT_BYTES + 1024) },
  ];
  for (const headers of cases) {
    const guarded = oversizedMcpAuthorityHeaderResponse(
      new Request("https://frege.dev/mcp", { headers }),
    );
    assert.notEqual(guarded, null);
    assert.equal(guarded.status, 403);
    const bodyText = await guarded.text();
    assert.ok(Buffer.byteLength(bodyText, "utf8") <= MCP_MAX_RESULT_BYTES);
    assert.ok(Buffer.byteLength(bodyText, "utf8") < 1024);
    const body = JSON.parse(bodyText);
    assert.equal(body.id, null);
    assert.equal(body.error.code, -32003);
    assert.doesNotMatch(body.error.message, /h{32}|o{32}/);
    assert.match(guarded.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(guarded.headers.get("location"), null);
    assert.equal(guarded.headers.get("access-control-allow-origin"), null);
  }

  const boundary = oversizedMcpAuthorityHeaderResponse(
    new Request("https://frege.dev/mcp", {
      headers: {
        Host: "h".repeat(MCP_MAX_HOST_HEADER_BYTES),
        Origin: "o".repeat(MCP_MAX_ORIGIN_HEADER_BYTES),
      },
    }),
  );
  assert.equal(boundary, null);
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
    "frege_audit_events",
  ];
  for (const name of forbidden) assert.equal(registered.includes(name), false, `${name} must not register`);
  assert.match(source, /response\.body\.getReader\(\)/);
  assert.doesNotMatch(source, /response\.text\(\)/);
  assert.match(source, /"X-Real-IP": clientIp\(sourceRequest\)/);
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
  assert.match(gateway, /includeClientIp: !auth/);
  assert.match(gateway, /const requestId = parsed\.value\.id/);
  assert.match(gateway, /finalizeMcpResponse\(response, \{ requestId \}\)/);
  assert.match(gateway, /hostHeaderValidationResponse/);
  assert.match(gateway, /originValidationResponse/);
  assert.match(gateway, /oversizedMcpAuthorityHeaderResponse\(req\)/);
  assert.match(middleware, /isMcpCredentialPath\(reqPath\)/);
  assert.match(middleware, /rawPathnameFromUrl\(req\.url\)/);
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
