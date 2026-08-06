import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  graphifyDoctor,
  graphifyIndex,
  graphifyQuery,
  runGraphify,
  validateGraphifyArtifact,
} from "../bin/graphify-local.mjs";

const CLI = fileURLToPath(new URL("../bin/frege-mcp.mjs", import.meta.url));

function artifact(overrides = {}) {
  return {
    schema: "frege.graphify.code-graph",
    version: 1,
    directed: true,
    nodes: [
      { id: "src_main", label: "main", path: "src/main.mjs", line: 1 },
      { id: "src_run", label: "run", path: "src/run.mjs", line: 4 },
    ],
    edges: [
      { source: "src_main", target: "src_run", relation: "calls", confidence: "EXTRACTED", path: "src/main.mjs", line: 2 },
    ],
    ...overrides,
  };
}

async function fixtureProject(name = "graphify project ") {
  const root = await mkdtemp(path.join(tmpdir(), name));
  const out = path.join(root, "graphify-out");
  await mkdir(out);
  await writeFile(path.join(out, "graph.json"), JSON.stringify({ fixture: "SECRET_GRAPH" }));
  await writeFile(path.join(out, "frege-code-graph.v1.json"), JSON.stringify(artifact()));
  return root;
}

async function stubGraphify(root) {
  const stub = path.join(root, "graphify-stub.mjs");
  await writeFile(stub, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (process.env.STUB_LOG) appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + "\\n");
if (process.env.STUB_MODE === "hang") setInterval(() => {}, 1000);
else if (process.env.STUB_MODE === "fail") process.exit(7);
else if (process.env.STUB_MODE === "huge") process.stdout.write("x".repeat(10000));
else if (args[0] === "--version") console.log("graphify " + (process.env.STUB_VERSION || "0.9.34"));
else if (args[0] === "query") console.log(process.env.STUB_QUERY_RESULT || "LOCAL_SECRET_RESULT");
else if (args[0] === "extract" || args[0] === "update") {
  const out = process.env.GRAPHIFY_OUT;
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "graph.json"), JSON.stringify({ fixture: "SECRET_GRAPH" }));
  console.log("indexed");
} else if (args[0] === "export" && args[1] === "frege") {
  const output = args[args.indexOf("--output") + 1];
  writeFileSync(output, Buffer.from(process.env.STUB_ARTIFACT, "base64").toString("utf8"));
  console.log("exported");
} else process.exit(9);
`);
  await chmod(stub, 0o755);
  return stub;
}

function envFor(stub, extra = {}) {
  return {
    ...process.env,
    FREGE_CODE_GRAPH: "true",
    FREGE_GRAPHIFY_BIN: stub,
    STUB_ARTIFACT: Buffer.from(JSON.stringify(artifact())).toString("base64"),
    ...extra,
  };
}

async function runMcp(cwd, env, messages) {
  const child = spawn(process.execPath, [CLI, "mcp", "serve"], {
    cwd,
    env: { ...process.env, FREGE_MCP_TRANSPORT: "jsonl", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  child.stdin.end();

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP timeout: ${stderr}`));
    }, 5_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`MCP exited ${code}: ${stderr}`));
    });
  });
  return new Map(stdout.trim().split("\n").filter(Boolean).map((line) => {
    const response = JSON.parse(line);
    return [response.id, response];
  }));
}

test("disabled integration stays absent and fails closed", async () => {
  const root = await fixtureProject();
  await assert.rejects(graphifyDoctor({ cwd: root, env: { ...process.env, FREGE_CODE_GRAPH: "false" } }), /not enabled/);
  const responses = await runMcp(root, { FREGE_CODE_GRAPH: "false" }, [
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "frege_code_graph_query", arguments: { query: "main" } } },
  ]);
  const names = responses.get(1).result.tools.map((tool) => tool.name);
  assert.equal(names.includes("frege_code_graph_query"), false);
  assert.equal(names.includes("frege_code_context"), false);
  assert.equal(responses.get(2).error.message, "unknown_tool:frege_code_graph_query");
});

test("doctor reports missing and incompatible binaries without leaking paths", async () => {
  const root = await fixtureProject();
  await assert.rejects(
    graphifyDoctor({ cwd: root, env: envFor(path.join(root, "missing-graphify")) }),
    (error) => error.message.includes("compatible fork") && !error.message.includes(root),
  );

  const stub = await stubGraphify(root);
  await assert.rejects(
    graphifyDoctor({ cwd: root, env: envFor(stub, { STUB_VERSION: "0.9.33" }) }),
    /0\.9\.34 or newer/,
  );
  assert.equal((await graphifyDoctor({ cwd: root, env: envFor(stub) })).schema, "frege.graphify.code-graph");
});

test("schema, malformed, oversized, and privacy-unsafe artifacts are rejected", async () => {
  assert.throws(() => validateGraphifyArtifact(artifact({ version: 2 })), /incompatible/);
  assert.throws(() => validateGraphifyArtifact(artifact({ nodes: [
    { id: "src_main", label: "main", path: "/Users/alice/private.mjs", line: 1 },
  ], edges: [] })), /absolute host path/);
  assert.throws(() => validateGraphifyArtifact(artifact({ nodes: [
    { id: "src_main", label: "main", path: "src/../private.mjs", line: 1 },
  ], edges: [] })), /normalized relative POSIX path/);
  assert.throws(() => validateGraphifyArtifact(artifact({ nodes: [
    { id: "src_main", label: "main", path: "~alice/private.mjs", line: 1 },
  ], edges: [] })), /normalized relative POSIX path/);
  assert.throws(() => validateGraphifyArtifact(artifact({ nodes: [
    { id: "src_main", label: "main", path: " /Users/alice/private.mjs", line: 1 },
  ], edges: [] })), /normalized relative POSIX path/);
  assert.throws(() => validateGraphifyArtifact(artifact({ nodes: [
    { id: "src_main", label: "main", path: "src/ padded /private.mjs", line: 1 },
  ], edges: [] })), /normalized relative POSIX path/);

  const root = await fixtureProject();
  const stub = await stubGraphify(root);
  await writeFile(path.join(root, "graphify-out", "frege-code-graph.v1.json"), "not json");
  await assert.rejects(graphifyDoctor({ cwd: root, env: envFor(stub) }), /malformed/);
  await writeFile(path.join(root, "graphify-out", "frege-code-graph.v1.json"), "x".repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(graphifyDoctor({ cwd: root, env: envFor(stub) }), /safe local size limit/);
  await assert.rejects(graphifyDoctor({ cwd: root, env: envFor(stub, { GRAPHIFY_OUT: "../private" }) }), /inside the current project/);

  const escapeRoot = await mkdtemp(path.join(tmpdir(), "graphify symlink project "));
  const outside = await mkdtemp(path.join(tmpdir(), "graphify outside "));
  const escapeStub = await stubGraphify(escapeRoot);
  await symlink(outside, path.join(escapeRoot, "escape"), "dir");
  await assert.rejects(
    graphifyIndex(".", { cwd: escapeRoot, env: envFor(escapeStub, { GRAPHIFY_OUT: "escape/out" }) }),
    /inside the current project/,
  );
});

test("process execution bounds timeout, failure, and output without exposing stderr", async () => {
  const root = await fixtureProject();
  const stub = await stubGraphify(root);
  await assert.rejects(runGraphify(["query"], { cwd: root, env: envFor(stub, { STUB_MODE: "hang" }), timeoutMs: 25 }), /timed out/);
  await assert.rejects(runGraphify(["query"], { cwd: root, env: envFor(stub, { STUB_MODE: "fail", SECRET: "do-not-print" }) }),
    (error) => error.message.includes("failed safely") && !error.message.includes("do-not-print"));
  await assert.rejects(runGraphify(["query"], { cwd: root, env: envFor(stub, { STUB_MODE: "huge" }), maxOutputBytes: 32 }), /safe local limit/);
});

test("index and query use deterministic bounded argv with no shell interpretation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "graphify argv project "));
  const stub = await stubGraphify(root);
  const log = path.join(root, "argv.jsonl");
  const env = envFor(stub, { STUB_LOG: log });
  const indexed = await graphifyIndex(".", { cwd: root, env });
  assert.equal(indexed.action, "indexed");

  const query = `main; touch ${path.join(root, "should-not-exist")}`;
  const first = await graphifyQuery(query, { cwd: root, env, budget: 4000 });
  const second = await graphifyQuery(query, { cwd: root, env, budget: 4000 });
  assert.equal(first, "LOCAL_SECRET_RESULT");
  assert.equal(second, first);
  await assert.rejects(graphifyQuery("main", { cwd: root, env, budget: 4001 }), /1 to 4000/);
  await assert.rejects(graphifyQuery("main", { cwd: root, env, budget: true }), /1 to 4000/);

  const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert(calls.some((args) => args[0] === "extract" && args.includes("--code-only")));
  assert(calls.some((args) => args[0] === "export" && args[1] === "frege"));
  assert(calls.some((args) => args[0] === "query" && args[1] === query && args.includes("4000")));
  await assert.rejects(readFile(path.join(root, "should-not-exist")), /ENOENT/);
});

test("combined MCP context never uploads the graph or local query result", async () => {
  const root = await fixtureProject();
  const stub = await stubGraphify(root);
  const bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      bodies.push(body);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ packet: "HOSTED_CONTEXT" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const responses = await runMcp(root, {
      ...envFor(stub),
      FREGE_BASE_URL: `http://127.0.0.1:${address.port}`,
      FREGE_API_KEY: "test-key",
    }, [
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "frege_code_context", arguments: { query: "main", limit: 3 } } },
    ]);
    const names = responses.get(1).result.tools.map((tool) => tool.name);
    assert(names.includes("frege_code_graph_query"));
    assert(names.includes("frege_code_context"));
    const text = responses.get(2).result.content[0].text;
    assert.match(text, /## Hosted context[\s\S]*HOSTED_CONTEXT/);
    assert.match(text, /## Local code graph[\s\S]*LOCAL_SECRET_RESULT/);
    assert.deepEqual(bodies.map(JSON.parse), [{ query: "main", limit: 3 }]);
    assert.equal(bodies.some((body) => body.includes("SECRET_GRAPH") || body.includes("LOCAL_SECRET_RESULT")), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
