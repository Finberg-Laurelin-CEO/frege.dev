#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const routeRoot = path.join(root, "app/api/v2");
const HTTP_METHOD_PATTERN = /export async function (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\([^)]*\)\s*\{/g;
const REQUIRED_GATE = /^\s*if \(!v2PreviewEnabled\(\)\) return v2PreviewDisabledResponse\(\);/;

function resolveAlias(specifier) {
  const base = path.join(root, specifier.slice(2));
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
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { v2PreviewDisabledResponse, v2PreviewEnabled } = await import(
  pathToFileURL(path.join(root, "lib/core/v2-preview.ts")).href
);

async function findRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findRouteFiles(absolutePath)));
    else if (entry.name === "route.ts") files.push(absolutePath);
  }

  return files.sort();
}

test("V2 preview is exact-opt-in and defaults off", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) {
    assert.equal(v2PreviewEnabled(value), false, `unexpected enable value: ${String(value)}`);
  }
  assert.equal(v2PreviewEnabled("true"), true);

  const previous = process.env.FREGE_V2_PREVIEW_ENABLED;
  delete process.env.FREGE_V2_PREVIEW_ENABLED;
  try {
    assert.equal(v2PreviewEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.FREGE_V2_PREVIEW_ENABLED;
    else process.env.FREGE_V2_PREVIEW_ENABLED = previous;
  }
});

test("disabled V2 returns a stable non-cacheable contract", async () => {
  const response = v2PreviewDisabledResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("retry-after"), false);
  assert.deepEqual(await response.json(), {
    error: "v2_preview_disabled",
    message: "The V2 technical preview is not enabled for this deployment.",
  });
});

test("every V2 route method gates before inspecting or acting on the request", async () => {
  const routeFiles = await findRouteFiles(routeRoot);
  assert.equal(routeFiles.length, 15, "update the reviewed V2 route inventory when routes change");

  let methodCount = 0;
  for (const absolutePath of routeFiles) {
    const relativePath = path.relative(root, absolutePath);
    const source = await readFile(absolutePath, "utf8");
    const matches = [...source.matchAll(HTTP_METHOD_PATTERN)];
    assert.ok(matches.length > 0, `${relativePath} must export an HTTP method`);
    assert.match(source, /from "@\/lib\/core\/v2-preview";/, `${relativePath} must import the shared V2 gate`);

    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const bodyStart = match.index + match[0].length;
      const bodyEnd = matches[index + 1]?.index ?? source.length;
      const body = source.slice(bodyStart, bodyEnd);
      assert.match(body, REQUIRED_GATE, `${relativePath} ${match[1]} must gate as its first statement`);
      methodCount += 1;
    }
  }

  assert.equal(methodCount, 21, "update the reviewed V2 method inventory when methods change");
});

test("every V2 route method returns the disabled contract at runtime without reading inputs", async () => {
  const routeFiles = await findRouteFiles(routeRoot);
  const poisonInput = new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`disabled V2 route read input property ${String(property)}`);
      },
    },
  );
  const previous = process.env.FREGE_V2_PREVIEW_ENABLED;
  delete process.env.FREGE_V2_PREVIEW_ENABLED;

  try {
    let methodCount = 0;
    for (const absolutePath of routeFiles) {
      const relativePath = path.relative(root, absolutePath);
      const source = await readFile(absolutePath, "utf8");
      const methods = [...source.matchAll(HTTP_METHOD_PATTERN)].map((match) => match[1]);
      const routeModule = await import(pathToFileURL(absolutePath).href);

      for (const method of methods) {
        assert.equal(typeof routeModule[method], "function", `${relativePath} must export ${method}`);
        const response = await routeModule[method](poisonInput, poisonInput);
        assert.equal(response.status, 503, `${relativePath} ${method} status`);
        assert.equal(response.headers.get("cache-control"), "no-store", `${relativePath} ${method} cache policy`);
        assert.deepEqual(
          await response.json(),
          {
            error: "v2_preview_disabled",
            message: "The V2 technical preview is not enabled for this deployment.",
          },
          `${relativePath} ${method} response body`,
        );
        methodCount += 1;
      }
    }
    assert.equal(methodCount, 21);
  } finally {
    if (previous === undefined) delete process.env.FREGE_V2_PREVIEW_ENABLED;
    else process.env.FREGE_V2_PREVIEW_ENABLED = previous;
  }
});
