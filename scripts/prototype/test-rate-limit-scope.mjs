#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VIRTUAL_DB = `
  export function getSql() {
    return globalThis.__fregeRateLimitScopeSql;
  }
`;

function resolveAlias(specifier) {
  const base = path.join(rootDir, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${base}.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") return { url: "virtual:rate-limit-db", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(resolveAlias(specifier)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "virtual:rate-limit-db") {
      return { format: "module", source: VIRTUAL_DB, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { checkRateLimit } = await import("../../lib/core/rate-limit.ts");

function captureSql() {
  const calls = [];
  globalThis.__fregeRateLimitScopeSql = (strings, ...values) => {
    calls.push({ text: strings.join(" "), values });
    return Promise.resolve([{ attempts: 1, window_start: new Date() }]);
  };
  return calls;
}

function requestFrom(ip) {
  return new Request("https://frege.dev/mcp", { headers: { "X-Forwarded-For": ip } });
}

const base = { action: "mcp_http_key", limit: 120, windowSeconds: 60, keyParts: ["org-1", "key-1"] };

test("authenticated key-global bucket cannot be multiplied by source IP", async () => {
  const calls = captureSql();
  await checkRateLimit(requestFrom("198.51.100.1"), { ...base, includeClientIp: false });
  await checkRateLimit(requestFrom("203.0.113.2"), { ...base, includeClientIp: false });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].values[0], calls[1].values[0]);
});

test("default pre-auth bucket remains IP scoped", async () => {
  const calls = captureSql();
  await checkRateLimit(requestFrom("198.51.100.1"), {
    action: "mcp_http_auth",
    limit: 60,
    windowSeconds: 60,
  });
  await checkRateLimit(requestFrom("203.0.113.2"), {
    action: "mcp_http_auth",
    limit: 60,
    windowSeconds: 60,
  });
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].values[0], calls[1].values[0]);
});
