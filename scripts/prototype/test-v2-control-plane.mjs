#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import test from "node:test";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const {
  digestPolicyRules,
  evaluateAuthorization,
  policyPatternMatches,
} = await import("../../lib/v2/policy-engine.ts");
const {
  authorizeRequestSchema,
  createCredentialSchema,
  createPrincipalSchema,
  policyRulesSchema,
} = await import("../../lib/v2/contracts.ts");
const {
  authenticateV2Credential,
  ensureServicePrincipal,
  loadInternalV2CredentialAuth,
  sanitizeProvenancePayload,
  V2ControlPlaneError,
} = await import("../../lib/v2/control-plane.ts");
const {
  generateDelegatedCredential,
  hashDelegatedCredential,
  parseDelegatedCredential,
} = await import("../../lib/v2/credentials.ts");

const IDS = {
  org: "00000000-0000-4000-8000-000000000001",
  otherOrg: "00000000-0000-4000-8000-000000000002",
  principal: "10000000-0000-4000-8000-000000000001",
  credential: "20000000-0000-4000-8000-000000000001",
  delegator: "10000000-0000-4000-8000-000000000002",
  policy: "30000000-0000-4000-8000-000000000001",
};

const ALLOW_SYNC = {
  id: "allow-connector-sync",
  effect: "allow",
  principal_types: ["service"],
  actions: ["connector.sync"],
  resource_types: ["connector_installation"],
};

function baseInput(overrides = {}) {
  const rules = overrides.rules ?? [ALLOW_SYNC];
  return {
    orgId: IDS.org,
    principal: {
      id: IDS.principal,
      org_id: IDS.org,
      principal_type: "service",
      status: "active",
      ...overrides.principal,
    },
    credential: {
      id: IDS.credential,
      org_id: IDS.org,
      principal_id: IDS.principal,
      status: "active",
      scopes: ["connector.sync"],
      not_before: "2026-01-01T00:00:00.000Z",
      expires_at: "2027-01-01T00:00:00.000Z",
      ...overrides.credential,
    },
    policy: {
      id: IDS.policy,
      org_id: IDS.org,
      slug: "connectors",
      version: 1,
      default_decision: "deny",
      rules,
      rules_digest: digestPolicyRules(rules),
      valid: true,
      ...overrides.policy,
    },
    action: "connector.sync",
    resource: {
      orgId: IDS.org,
      type: "connector_installation",
      id: "installation-1",
      ...overrides.resource,
    },
    now: new Date("2026-07-19T12:00:00.000Z"),
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => !["principal", "credential", "policy", "resource", "rules"].includes(key)),
    ),
  };
}

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [value, ...tail]),
  );
}

test("the valid connector service slice allows only the policy-matched action", () => {
  assert.deepEqual(evaluateAuthorization(baseInput()), {
    decision: "allow",
    reasonCode: "allowed_by_policy",
    matchingRuleId: "allow-connector-sync",
  });
  assert.deepEqual(evaluateAuthorization(baseInput({ action: "source.read" })), {
    decision: "deny",
    reasonCode: "credential_scope_mismatch",
    matchingRuleId: null,
  });
});

test("namespace wildcards respect segment boundaries", () => {
  assert.equal(policyPatternMatches("connector.*", "connector.sync"), true);
  assert.equal(policyPatternMatches("connector.*", "connector"), false);
  assert.equal(policyPatternMatches("connector.*", "connectorx.sync"), false);
  assert.equal(policyPatternMatches("source.read", "source.read"), true);
  assert.equal(policyPatternMatches("source.read", "source.write"), false);
});

test("tenant mismatch is a non-bypassable deny across every identity/resource edge", () => {
  const variants = [
    { orgId: IDS.otherOrg },
    { principal: { org_id: IDS.otherOrg } },
    { credential: { org_id: IDS.otherOrg } },
    { credential: { principal_id: "10000000-0000-4000-8000-000000000099" } },
    { policy: { org_id: IDS.otherOrg } },
    { resource: { orgId: IDS.otherOrg } },
  ];
  for (const variant of variants) {
    assert.deepEqual(evaluateAuthorization(baseInput(variant)), {
      decision: "deny",
      reasonCode: "tenant_mismatch",
      matchingRuleId: null,
    });
  }
});

test("explicit deny overrides allow for every rule ordering", () => {
  const rules = [
    ALLOW_SYNC,
    { id: "allow-any-service", effect: "allow", principal_types: ["service"], actions: ["connector.*"], resource_types: ["*"] },
    { id: "deny-installation", effect: "deny", actions: ["connector.sync"], resource_types: ["connector_installation"], resource_ids: ["installation-1"] },
    { id: "unrelated", effect: "deny", actions: ["source.write"], resource_types: ["brain_source"] },
  ];
  for (const ordering of permutations(rules)) {
    const result = evaluateAuthorization(baseInput({ rules: ordering }));
    assert.equal(result.decision, "deny");
    assert.equal(result.reasonCode, "explicit_deny");
    assert.equal(result.matchingRuleId, "deny-installation");
  }
});

test("credential status, lifetime, scope, principal state, and policy integrity all fail closed", () => {
  const cases = [
    [{ principal: { status: "disabled" } }, "principal_inactive"],
    [{ credential: { status: "revoked" } }, "credential_inactive"],
    [{ credential: { not_before: "2026-08-01T00:00:00.000Z" } }, "credential_not_yet_valid"],
    [{ credential: { expires_at: "2026-07-01T00:00:00.000Z" } }, "credential_expired"],
    [{ credential: { scopes: ["source.read"] } }, "credential_scope_mismatch"],
    [{ policy: { valid: false } }, "policy_invalid"],
    [{ rules: [] }, "default_deny"],
  ];
  for (const [override, reason] of cases) {
    const result = evaluateAuthorization(baseInput(override));
    assert.equal(result.decision, "deny");
    assert.equal(result.reasonCode, reason);
  }
});

test("scope and policy must both match across a generated action matrix", () => {
  const actions = ["connector.sync", "connector.read", "source.read", "source.write", "connectorx.sync"];
  const scopes = ["connector.sync", "connector.*", "source.read"];
  const allowRule = {
    id: "allow-tested-action",
    effect: "allow",
    principal_types: ["service"],
    actions: ["connector.*", "source.read"],
    resource_types: ["connector_installation"],
  };
  for (const scope of scopes) {
    for (const action of actions) {
      const result = evaluateAuthorization(baseInput({ action, rules: [allowRule], credential: { scopes: [scope] } }));
      const expected = policyPatternMatches(scope, action) && allowRule.actions.some((rule) => policyPatternMatches(rule, action));
      assert.equal(result.decision === "allow", expected, `${scope} / ${action}`);
    }
  }
});

test("wire schemas require concrete agent subjects and reject unscoped or content-bearing requests", () => {
  assert.equal(
    createPrincipalSchema.safeParse({
      org_slug: "acme",
      principal_type: "agent",
      slug: "research-agent",
      name: "Research agent",
    }).success,
    false,
  );
  assert.equal(
    createCredentialSchema.safeParse({
      org_slug: "acme",
      principal_id: IDS.principal,
      policy_version_id: IDS.policy,
      name: "unbounded",
      scopes: ["*"],
    }).success,
    false,
  );
  for (const forbidden of [
    { content: "restricted source text" },
    { body: "restricted source text" },
    { prompt: "restricted source text" },
    { attributes: { sensitivity: "public" } },
  ]) {
    const result = authorizeRequestSchema.safeParse({
      action: "source.read",
      resource: { type: "brain_source", id: "source-1", ...forbidden },
    });
    assert.equal(result.success, false);
    assert.equal(JSON.stringify(result).includes("restricted source text"), false);
  }
});

test("policy documents are strict, default-deny-compatible identifier sets", () => {
  assert.equal(policyRulesSchema.safeParse([ALLOW_SYNC]).success, true);
  assert.equal(policyRulesSchema.safeParse([{ ...ALLOW_SYNC, id: "duplicate" }, { ...ALLOW_SYNC, id: "duplicate" }]).success, false);
  assert.equal(policyRulesSchema.safeParse([{ ...ALLOW_SYNC, conditions: { trust_zone: "green" } }]).success, false);
  assert.equal(digestPolicyRules([ALLOW_SYNC]), digestPolicyRules([{ resource_types: ["connector_installation"], actions: ["connector.sync"], principal_types: ["service"], effect: "allow", id: "allow-connector-sync" }]));
});

test("provenance redaction covers snake_case, camelCase, kebab-case, nested values, and size bounds", () => {
  const secret = "DO_NOT_PERSIST_THIS_SECRET";
  const sanitized = sanitizeProvenancePayload({
    raw_credential: secret,
    rawCredential: secret,
    accessToken: secret,
    "private-key": secret,
    nested: { apiKey: secret, safe_id: "source-1" },
    list: [{ refreshToken: secret }],
    long_safe_value: "a".repeat(700),
  });
  const encoded = JSON.stringify(sanitized);
  assert.equal(encoded.includes(secret), false);
  assert.equal(sanitized.nested.safe_id, "source-1");
  assert.equal(sanitized.long_safe_value.length, 515);
});

test("delegated credentials use a separate prefix and domain-separated salted hash", () => {
  const generated = generateDelegatedCredential("test-salt");
  assert.match(generated.rawCredential, /^frg_v2_[a-f0-9]{12}_/);
  assert.deepEqual(parseDelegatedCredential(generated.rawCredential), {
    rawCredential: generated.rawCredential,
    keyPrefix: generated.keyPrefix,
  });
  assert.equal(generated.keyHash, hashDelegatedCredential(generated.rawCredential, "test-salt"));
  assert.notEqual(generated.keyHash, hashDelegatedCredential(generated.rawCredential, "other-salt"));
});

function validInternalRow(overrides = {}) {
  const rules = [ALLOW_SYNC];
  return {
    org_id: IDS.org,
    org_slug: "acme",
    org_name: "Acme",
    org_status: "active",
    principal_id: IDS.principal,
    principal_type: "service",
    principal_slug: "github-sync",
    principal_name: "GitHub sync",
    principal_status: "active",
    subject_user_id: null,
    subject_agent_id: null,
    subject_active: true,
    principal_created_by: IDS.delegator,
    principal_created_at: "2026-01-01T00:00:00.000Z",
    principal_updated_at: "2026-01-01T00:00:00.000Z",
    credential_id: IDS.credential,
    credential_name: "GitHub sync internal",
    key_prefix: "abcdef123456",
    key_hash: "a".repeat(64),
    scopes: ["connector.sync", "source.read"],
    credential_status: "active",
    delegated_by_principal_id: IDS.delegator,
    not_before: "2026-01-01T00:00:00.000Z",
    expires_at: "2027-01-01T00:00:00.000Z",
    last_used_at: new Date().toISOString(),
    revoked_at: null,
    credential_created_at: "2026-01-01T00:00:00.000Z",
    policy_id: IDS.policy,
    policy_slug: "connectors",
    policy_version: 1,
    default_decision: "deny",
    policy_rules: rules,
    rules_digest: digestPolicyRules(rules),
    policy_created_by: IDS.delegator,
    policy_created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeSqlForRow(row) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    if (text.includes("from v2_credential_auth_context")) return row ? [row] : [];
    if (text.startsWith("update delegated_credentials")) return [];
    throw new Error(`unexpected sql: ${text}`);
  };
  return { sql, calls };
}

test("trusted internal credential loading requires all selectors and every active/integrity invariant", async () => {
  const { sql, calls } = fakeSqlForRow(validInternalRow());
  const auth = await loadInternalV2CredentialAuth(
    { orgId: IDS.org, credentialId: IDS.credential, principalId: IDS.principal },
    sql,
  );
  assert.ok(auth);
  assert.equal(auth.policy.valid, true);
  assert.deepEqual(calls[0].values, [IDS.org, IDS.credential, IDS.principal]);

  const invalidRows = [
    validInternalRow({ org_status: "suspended" }),
    validInternalRow({ principal_status: "disabled" }),
    validInternalRow({ credential_status: "revoked" }),
    validInternalRow({ subject_active: false }),
    validInternalRow({ expires_at: "2026-01-01T00:00:00.000Z" }),
    validInternalRow({ default_decision: "allow" }),
    validInternalRow({ rules_digest: "b".repeat(64) }),
    validInternalRow({ org_id: IDS.otherOrg }),
    validInternalRow({ principal_id: "10000000-0000-4000-8000-000000000099" }),
    validInternalRow({ credential_id: "20000000-0000-4000-8000-000000000099" }),
  ];
  for (const row of invalidRows) {
    const fake = fakeSqlForRow(row);
    const result = await loadInternalV2CredentialAuth(
      { orgId: IDS.org, credentialId: IDS.credential, principalId: IDS.principal },
      fake.sql,
    );
    assert.equal(result, null);
    assert.equal(fake.calls.length, 1, "invalid rows must not refresh last_used_at");
  }
});

test("ensuring a disabled service principal does not reactivate it", async () => {
  const disabled = {
    id: IDS.principal,
    org_id: IDS.org,
    principal_type: "service",
    slug: "github-sync",
    name: "GitHub sync",
    status: "disabled",
    subject_user_id: null,
    subject_agent_id: null,
    created_by_principal_id: IDS.delegator,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const sql = async () => [disabled];
  await assert.rejects(
    ensureServicePrincipal({ orgId: IDS.org, slug: "github-sync", name: "GitHub sync" }, sql),
    (error) => error instanceof V2ControlPlaneError && error.code === "principal_inactive",
  );
});

test("migration locks subject identity, tenant references, default deny, and content-free legacy projection", async () => {
  const migration = await readFile(path.join(rootDir, "db/028_v2_control_plane.sql"), "utf8");
  assert.match(migration, /foreign key \(org_id, subject_user_id\)[\s\S]*references organization_memberships\(org_id, user_id\) on delete restrict/);
  assert.match(migration, /foreign key \(org_id, subject_agent_id\)[\s\S]*references agent_definitions\(org_id, id\) on delete restrict/);
  assert.match(migration, /principal_type = 'human' and subject_user_id is not null/);
  assert.match(migration, /principal_type = 'agent' and subject_user_id is null and subject_agent_id is not null/);
  for (const reference of ["principal_id", "delegated_by_principal_id", "policy_version_id", "delegated_credential_id"]) {
    assert.match(migration, new RegExp(`foreign key \\(org_id, ${reference}\\)`));
  }
  assert.match(migration, /default_decision = 'deny'/);
  assert.match(migration, /frege_v2_valid_credential_scopes\(scopes\)/);
  assert.match(migration, /authorization_receipts_request_id_chk/);
  const projection = migration.slice(migration.indexOf("create or replace view unified_provenance_events"));
  assert.equal(projection.includes("telemetry_events.metadata"), false);
  assert.equal(projection.includes("audit_events.metadata"), false);
});

if (process.env.V2_CONTROL_PLANE_INTEGRATION === "1") {
  // lib/db.ts uses a dev-only CommonJS pg load that Next transpiles in normal
  // app execution. Supply the equivalent loader for this direct ESM test.
  globalThis.require = createRequire(import.meta.url);

  test("live V2 route contract records allow and deny without accepting resource content", async () => {
    const rawCredential = process.env.V2_TEST_RAW_CREDENTIAL;
    assert.ok(rawCredential, "V2_TEST_RAW_CREDENTIAL is required for integration mode");
    const headers = { Authorization: `Bearer ${rawCredential}`, "Content-Type": "application/json" };
    const authorizeRoute = await import("../../app/api/v2/authorize/route.ts");
    const meRoute = await import("../../app/api/v2/me/route.ts");
    const healthRoute = await import("../../app/api/v1/health/route.ts");

    const authResult = await authenticateV2Credential(
      new Request("http://localhost/api/v2/me", { headers: { Authorization: `Bearer ${rawCredential}` } }),
    );
    assert.equal(authResult.ok, true);

    const me = await meRoute.GET(
      new Request("http://localhost/api/v2/me", { headers: { Authorization: `Bearer ${rawCredential}` } }),
    );
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.principal.principal_type, "service");
    assert.deepEqual(meBody.credential.scopes, ["connector.sync", "source.read"]);
    assert.equal("rules" in meBody.policy, false);

    const allow = await authorizeRoute.POST(
      new Request("http://localhost/api/v2/authorize", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "connector.sync",
          resource: { type: "connector_installation", id: "installation-live-check" },
        }),
      }),
    );
    assert.equal(allow.status, 200);
    const allowBody = await allow.json();
    assert.equal(allowBody.authorization_receipt.decision, "allow");
    assert.equal(allowBody.authorization_receipt.policy.matching_rule_id, "allow-sync");
    assert.equal(allow.headers.get("x-frege-correlation-id"), allowBody.authorization_receipt.correlation_id);

    const deny = await authorizeRoute.POST(
      new Request("http://localhost/api/v2/authorize", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "source.read",
          resource: { type: "brain_source", id: "restricted-source-live-check" },
        }),
      }),
    );
    assert.equal(deny.status, 403);
    const denyBody = await deny.json();
    assert.equal(denyBody.authorization_receipt.decision, "deny");
    assert.equal(denyBody.authorization_receipt.reason_code, "default_deny");
    assert.equal(JSON.stringify(denyBody).includes("body_md"), false);
    assert.equal(JSON.stringify(denyBody).includes("content"), false);

    const sentinel = "RESTRICTED_SENTINEL_MUST_NOT_ECHO";
    const rejected = await authorizeRoute.POST(
      new Request("http://localhost/api/v2/authorize", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "source.read",
          resource: { type: "brain_source", id: "source-live-check", content: sentinel },
        }),
      }),
    );
    assert.equal(rejected.status, 400);
    assert.equal(JSON.stringify(await rejected.json()).includes(sentinel), false);

    const health = await healthRoute.GET();
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  });
}
