#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// actor-auth.ts is not an import-clean "core" module: it (transitively) uses the
// TypeScript `@/*` path alias, which Node cannot resolve on its own. Register an
// in-process resolve hook that maps `@/<x>` -> <repoRoot>/<x> so we can import the
// real assertActiveActorOrg and exercise it. Static imports are hoisted before this
// runs, so actor-auth is pulled in via a dynamic import below.
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

const { assertActiveActorOrg } = await import(
  pathToFileURL(path.join(rootDir, "lib/prototype/actor-auth.ts")).href
);

// Minimal objects shaped like each FregeActorContext variant. assertActiveActorOrg
// is generic over both shapes and only reads `organization.status`.
function apiKeyActor(status) {
  return {
    actorType: "api_key",
    organization: { id: "org-1", slug: "acme", name: "Acme", status },
    allowedLabels: ["public"],
    capabilities: { canManageOrg: false, canManageModels: false, canManageKeys: false },
  };
}

function userActor(status) {
  return {
    actorType: "user",
    organization: { id: "org-1", slug: "acme", name: "Acme", status },
    allowedLabels: ["public", "internal"],
    capabilities: { canManageOrg: true },
  };
}

const shapes = [
  { name: "api_key", make: apiKeyActor },
  { name: "user", make: userActor },
];

for (const shape of shapes) {
  test(`assertActiveActorOrg allows an active org (${shape.name} shape)`, () => {
    assert.equal(assertActiveActorOrg(shape.make("active")), null);
  });

  for (const status of ["inactive", "suspended"]) {
    test(`assertActiveActorOrg blocks a ${status} org with a 403 (${shape.name} shape)`, async () => {
      const response = assertActiveActorOrg(shape.make(status));
      assert.ok(response instanceof Response, "expected a Response");
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.error, "org_inactive");
      assert.equal(body.org_status, status);
    });
  }
}
