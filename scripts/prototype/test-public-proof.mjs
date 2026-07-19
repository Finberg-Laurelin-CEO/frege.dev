import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  PUBLIC_PROOF,
  PUBLIC_PROOF_FORBIDDEN_PATTERNS,
  serializePublicProof,
} from "../../lib/public-proof.ts";

test("public proof covers the complete governed loop", () => {
  assert.equal(PUBLIC_PROOF.duration, "90 seconds");
  assert.deepEqual(
    PUBLIC_PROOF.steps.map((step) => step.id),
    [
      "resolve-caller",
      "build-context",
      "withhold-restricted",
      "propose-update",
      "human-review",
      "audit-receipt",
    ],
  );
});

test("public proof names only shipped CLI or MCP surfaces", async () => {
  const cliSource = await readFile(
    new URL("../../packages/frege-cli/bin/frege-mcp.mjs", import.meta.url),
    "utf8",
  );
  assert.match(cliSource, /if \(command === "doctor"\)/);
  assert.match(cliSource, /if \(command === "context"\)/);
  assert.match(cliSource, /name: "frege_propose_memory_from_session"/);
  assert.match(cliSource, /name: "frege_audit_events"/);
  assert.doesNotMatch(serializePublicProof(), /frege (?:memory|audit)\b/);
});

test("public proof contains no credential, account, or customer identifiers", () => {
  const serialized = serializePublicProof();
  for (const pattern of PUBLIC_PROOF_FORBIDDEN_PATTERNS) {
    assert.equal(pattern.test(serialized), false, `public proof matched forbidden pattern ${pattern}`);
  }
});

test("denial evidence explains the boundary without naming restricted sources", () => {
  const denial = PUBLIC_PROOF.steps.find((step) => step.id === "withhold-restricted");
  assert.ok(denial);
  assert.match(denial.result, /without returning titles, snippets, or content/i);
  assert.equal(denial.evidence.some((item) => /\.md@v\d+/i.test(item)), false);
});
