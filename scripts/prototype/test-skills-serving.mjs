#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VIRTUAL = {
  "@/lib/db": "export function getSql(){ return globalThis.__skillsSql; }",
  "@/lib/core/admin-auth":
    "export async function authenticateAdminRequest(){ return globalThis.__skillsAdminResult; }",
  "@/lib/core/actor-auth": `
    export async function authenticateFregeActor(){ return globalThis.__skillsActorResult; }
    export function telemetryActorForFregeActor(actor){
      return actor.actorType === "api_key"
        ? { type: "api_key", auth: actor.apiKeyAuth }
        : { type: "user", auth: actor.userAuth };
    }
  `,
  "@/lib/core/request-guards":
    "export function routeError(label, err){ throw new Error(`${label}: ${err?.message ?? err}`); }",
  "@/lib/core/telemetry":
    "export async function logTelemetryEvent(event){ globalThis.__skillsTelemetry.push(event); }",
};

function resolveRealAlias(specifier) {
  const base = path.join(rootDir, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${base}.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in VIRTUAL) return { url: `virtual:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(resolveRealAlias(specifier)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("virtual:")) {
      return { format: "module", source: VIRTUAL[url.slice("virtual:".length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

process.env.FREGE_SKILLS_COMPILER = "true";

const listRoute = await import(pathToFileURL(path.join(rootDir, "app/api/v1/skills/route.ts")).href);
const getRoute = await import(
  pathToFileURL(path.join(rootDir, "app/api/v1/skills/[slug]/route.ts")).href
);

const SKILLS = [
  {
    id: "skill-public-id",
    slug: "deploy-safely",
    title: "Deploy safely",
    body_md: "Check the release gate.[^1]",
    citations: [{ ref: "session-event:event-1", label: "Release handbook" }],
    frontmatter: {
      description: "Deploy through the governed release gate",
      citations: [{ ref: "session-event:event-1", label: "Release handbook" }],
    },
    valid_from: "2026-07-22T00:00:00.000Z",
    stale: false,
    stale_reason: null,
    trust_zone: "green",
  },
  {
    id: "skill-restricted-id",
    slug: "restricted-runbook",
    title: "Restricted runbook",
    body_md: "Use the private escalation path.[^1]",
    citations: [{ ref: "session-event:event-2" }],
    frontmatter: { citations: [{ ref: "session-event:event-2" }] },
    valid_from: "2026-07-22T00:00:00.000Z",
    stale: true,
    stale_reason: "Conflicting procedure found",
    trust_zone: "red",
  },
];

function queryText(strings) {
  return strings.join(" ? ").replace(/\s+/g, " ").trim().toLowerCase();
}

function setup({ restricted = false } = {}) {
  const calls = [];
  const actor = {
    actorType: "api_key",
    organization: { id: "org-1", slug: "acme", status: "active" },
    allowedLabels: restricted ? ["public", "internal", "restricted"] : ["public", "internal"],
    apiKeyAuth: {
      organization: { id: "org-1", slug: "acme", status: "active" },
      key: { id: "key-1", owner_user_id: "user-1" },
    },
  };
  const admin = {
    user: { id: "admin-1" },
    organization: { id: "org-1", slug: "acme" },
    membership: { org_status: "active" },
  };

  globalThis.__skillsActorResult = { ok: true, actor };
  globalThis.__skillsAdminResult = { ok: true, auth: admin };
  globalThis.__skillsTelemetry = [];
  globalThis.__skillsSql = async (strings, ...values) => {
    const text = queryText(strings);
    calls.push({ text, values });
    const allowedZones = values.find(Array.isArray) ?? ["green", "red"];
    const visible = SKILLS.filter((skill) => allowedZones.includes(skill.trust_zone));

    if (!text.includes("join lateral")) {
      return visible.map(({ slug, title, valid_from, stale, stale_reason }) => ({
        slug,
        title,
        valid_from,
        stale,
        stale_reason,
      }));
    }

    const slug = values[1];
    const skill = visible.find((entry) => entry.slug === slug);
    return skill ? [skill] : [];
  };

  return { calls, telemetry: globalThis.__skillsTelemetry };
}

function request(pathname) {
  return new Request(`https://frege.dev${pathname}`);
}

function params(slug) {
  return { params: Promise.resolve({ slug }) };
}

test("flag off hides both serving routes before auth or SQL", async () => {
  const { calls } = setup();
  process.env.FREGE_SKILLS_COMPILER = "false";
  try {
    const list = await listRoute.GET(request("/api/v1/skills"));
    const get = await getRoute.GET(request("/api/v1/skills/deploy-safely"), params("deploy-safely"));
    assert.equal(list.status, 404);
    assert.equal(get.status, 404);
    assert.deepEqual(await list.json(), { error: "not_found" });
    assert.deepEqual(await get.json(), { error: "not_found" });
    assert.equal(calls.length, 0);
  } finally {
    process.env.FREGE_SKILLS_COMPILER = "true";
  }
});

test("an unscoped actor sees the same not_found for restricted and missing slugs", async () => {
  const { telemetry } = setup();
  const restricted = await getRoute.GET(
    request("/api/v1/skills/restricted-runbook"),
    params("restricted-runbook"),
  );
  const missing = await getRoute.GET(request("/api/v1/skills/missing"), params("missing"));

  assert.equal(restricted.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await restricted.json(), await missing.json());
  assert.equal(telemetry.length, 0);
});

test("list is silent and only an approved skill get emits retrieval telemetry", async () => {
  const { calls, telemetry } = setup();
  const list = await listRoute.GET(request("/api/v1/skills"));
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), {
    skills: [
      {
        slug: "deploy-safely",
        title: "Deploy safely",
        valid_from: "2026-07-22T00:00:00.000Z",
        stale: false,
        stale_reason: null,
      },
    ],
  });
  assert.equal(telemetry.length, 0);

  const get = await getRoute.GET(
    request("/api/v1/skills/deploy-safely"),
    params("deploy-safely"),
  );
  assert.equal(get.status, 200);
  assert.equal((await get.json()).skill.slug, "deploy-safely");
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].action, "skill.retrieved");
  assert.equal(telemetry[0].resourceType, "skill");
  assert.equal(telemetry[0].resourceId, "skill-public-id");
  assert(calls.every((call) => call.text.includes("artifact_type = 'skill'")));
  assert(calls.every((call) => call.text.includes("invalidated_at is null")));
});

test("skillmd export is admin-authed, cited markdown and not a retrieval", async () => {
  const { telemetry } = setup();
  const response = await getRoute.GET(
    request("/api/v1/skills/deploy-safely?format=skillmd"),
    params("deploy-safely"),
  );
  const markdown = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.match(markdown, /^---\nname: "deploy-safely"\ndescription: /);
  assert.match(markdown, /Check the release gate\.\[\^1\]/);
  assert.match(markdown, /\[\^1\]: Release handbook — session-event:event-1/);
  assert.deepEqual(telemetry.map((event) => event.action), ["admin.skills.export"]);
});

const cliPath = path.join(rootDir, "packages/frege-cli/bin/frege-mcp.mjs");

async function runMcp(messages, env) {
  const child = spawn(process.execPath, [cliPath, "mcp", "serve"], {
    cwd: rootDir,
    env: { ...process.env, FREGE_MCP_TRANSPORT: "jsonl", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const responses = [];

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    while (stdout.includes("\n")) {
      const newline = stdout.indexOf("\n");
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  child.stdin.end();

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP timeout: ${stderr}`));
    }, 5_000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`MCP exited ${code}: ${stderr}`));
    });
  });

  return new Map(responses.map((response) => [response.id, response]));
}

test("MCP skill tools register and proxy list/get to a running server", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/api/v1/skills"
          ? { skills: [{ slug: "deploy-safely" }] }
          : { skill: { slug: "deploy/safely" } },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const responses = await runMcp(
      [
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "frege_list_skills", arguments: {} },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "frege_get_skill", arguments: { slug: "deploy/safely" } },
        },
      ],
      {
        FREGE_SKILLS_COMPILER: "true",
        FREGE_BASE_URL: `http://127.0.0.1:${address.port}`,
        FREGE_API_KEY: "test-key",
      },
    );

    const names = responses.get(1).result.tools.map((tool) => tool.name);
    assert(names.includes("frege_list_skills"));
    assert(names.includes("frege_get_skill"));
    assert.deepEqual(JSON.parse(responses.get(2).result.content[0].text), {
      skills: [{ slug: "deploy-safely" }],
    });
    assert.deepEqual(JSON.parse(responses.get(3).result.content[0].text), {
      skill: { slug: "deploy/safely" },
    });
    assert.deepEqual(requests.sort(), ["/api/v1/skills", "/api/v1/skills/deploy%2Fsafely"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("flag off removes MCP skill tools and direct calls use the standard error shape", async () => {
  const responses = await runMcp(
    [
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "frege_list_skills", arguments: {} },
      },
    ],
    { FREGE_SKILLS_COMPILER: "false", FREGE_API_KEY: "test-key" },
  );

  const names = responses.get(1).result.tools.map((tool) => tool.name);
  assert.equal(names.includes("frege_list_skills"), false);
  assert.equal(names.includes("frege_get_skill"), false);
  assert.equal(responses.get(2).error.code, -32000);
  assert.equal(responses.get(2).error.message, "unknown_tool:frege_list_skills");
});
