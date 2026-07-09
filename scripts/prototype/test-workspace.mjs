#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// workspace-core.ts imports shared modules through the TypeScript "@/" path
// alias; register the same resolve hook as test-signup-flow.mjs mapping
// "@/<x>" -> <repoRoot>/<x>. Two modules are stubbed to keep the test hermetic:
// - "@/lib/core/session": request-guards pulls it in for assertSafeBrowserMutation
//   (readSessionToken only) and it would load the DB driver.
// - "@/lib/db": org-guard imports getSql for ensureDefaultAgentRoles (unused
//   here — the flow gets sql injected); the stub guarantees no driver loads.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VIRTUAL = {
  "@/lib/core/session": "export const readSessionToken = () => null;",
  "@/lib/db": "export const getSql = () => { throw new Error('getSql is stubbed in tests'); };",
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
    if (specifier.startsWith("@/")) return { url: pathToFileURL(resolveRealAlias(specifier)).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("virtual:")) {
      return { format: "module", source: VIRTUAL[url.slice("virtual:".length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { handleWorkspaceCreateRequest } = await import("../../lib/core/workspace-core.ts");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOST = "brain.frege.dev";

function jsonRequest(body) {
  return new Request(`https://${HOST}/api/v1/auth/workspace`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: HOST,
      Origin: `https://${HOST}`,
      "User-Agent": "workspace-test",
    },
    body: JSON.stringify(body),
  });
}

const SESSION = {
  user: { id: "user-1", email: "ada@example.com", name: "Ada Lovelace" },
  memberships: [],
};

function queryText(strings) {
  return strings.join(" ").replace(/\s+/g, " ").trim();
}

function isWriteStatement(text) {
  return text.startsWith("insert into") || text.startsWith("update");
}

// Neon-like fake mirroring test-signup-flow.mjs: sql`...` builds a LAZY
// statement that only executes when awaited — directly (the flow's reads) or
// inside sql.transaction (the atomic batch). `executed` records real execution
// so tests can prove no write ever runs outside the single transaction.
function makeWorkspaceSql({ existingSignupRow = null, failOnText = null, failCode = null } = {}) {
  const calls = [];
  const executed = [];
  const transactions = [];

  const run = (text, values) => {
    executed.push({ text, values });
    if (failOnText && text.includes(failOnText)) {
      const err = new Error(`forced failure: ${failOnText}`);
      if (failCode) err.code = failCode;
      throw err;
    }
    if (text.includes("select id as signup_id from signups")) {
      return existingSignupRow ? [existingSignupRow] : [];
    }
    if (text.includes("select 1 from organizations where slug")) return [];
    if (text.includes("insert into signups")) {
      return [
        {
          id: values[0],
          created_at: new Date("2026-07-01T00:00:00.000Z"),
          name: values[3],
          work_email: values[4],
          company: values[5],
          role: values[6],
          company_size: values[7],
          expected_users: values[8],
          current_agent_tools: values[9],
          other_tool: values[10],
          monthly_ai_spend: values[11],
          willing_to_pay: values[12],
          decision_timeline: values[13],
          main_pain_point: values[14],
          other_comments: values[15],
        },
      ];
    }
    if (text.includes("update signups")) {
      // A pre-existing lead-capture row: original survey answers survive.
      return [
        {
          id: existingSignupRow?.signup_id,
          created_at: new Date("2026-06-01T00:00:00.000Z"),
          name: "Ada Lovelace",
          work_email: "ada@example.com",
          company: "Original Company",
          role: "CTO",
          company_size: "201-1000",
          expected_users: 80,
          current_agent_tools: ["Internal agent"],
          other_tool: "",
          monthly_ai_spend: "$10,000+",
          willing_to_pay: "$2,000-$10,000 / mo",
          decision_timeline: "Now",
          main_pain_point: "Agent access control",
          other_comments: "",
        },
      ];
    }
    if (isWriteStatement(text)) return [];
    throw new Error(`unexpected workspace SQL: ${text}`);
  };

  const sql = (strings, ...values) => {
    const text = queryText(strings);
    calls.push({ text, values });
    return {
      text,
      values,
      then: (onFulfilled, onRejected) =>
        Promise.resolve()
          .then(() => run(text, values))
          .then(onFulfilled, onRejected),
    };
  };
  sql.transaction = async (queries) => {
    transactions.push(queries.map((query) => query.text));
    const results = [];
    for (const query of queries) results.push(await query);
    return results;
  };
  return { sql, calls, executed, transactions };
}

function makeDeps(sql, { session = SESSION, overrides = {} } = {}) {
  const telemetry = [];
  const hermesEvents = [];
  const monitorEvents = [];
  const hotLeadAlerts = [];
  const rateLimitCalls = [];
  const deps = {
    getSql: () => sql,
    authenticateUser: async () => session,
    checkRateLimit: async (req, input) => {
      rateLimitCalls.push(input);
      return { allowed: true, attempts: 1, limit: input.limit, retryAfterSeconds: 0 };
    },
    rateLimitedResponse: () => Response.json({ error: "rate_limited" }, { status: 429 }),
    logTelemetryEvent: async (event) => {
      telemetry.push(event);
    },
    postHermesEvent: async (payload) => {
      hermesEvents.push(payload);
      return { ok: true };
    },
    recordSignupMonitorEvent: async (eventType, payload) => {
      monitorEvents.push({ eventType, payload });
    },
    maybeSendHotLeadAlert: async (lead, signup) => {
      hotLeadAlerts.push({ lead, signup });
      return { sent: false, reason: "not_configured" };
    },
    ...overrides,
  };
  return { deps, telemetry, hermesEvents, monitorEvents, hotLeadAlerts, rateLimitCalls };
}

const VALID_BODY = { org_name: "Acme AI", plan: "team-monthly", seats: 3 };

test("workspace create rejects unauthenticated callers with 401 and touches nothing", async () => {
  const { sql, executed, transactions } = makeWorkspaceSql();
  const { deps, telemetry, monitorEvents, hermesEvents } = makeDeps(sql, { session: null });

  const response = await handleWorkspaceCreateRequest(jsonRequest(VALID_BODY), deps);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.deepEqual(executed, []);
  assert.equal(transactions.length, 0);
  assert.deepEqual([telemetry, monitorEvents, hermesEvents], [[], [], []]);
});

test("workspace create returns 409 workspace_exists for users with an active membership", async () => {
  const { sql, executed, transactions } = makeWorkspaceSql();
  const withOrg = {
    ...SESSION,
    memberships: [{ org_id: "org-1", status: "active" }],
  };
  const { deps, telemetry, monitorEvents } = makeDeps(sql, { session: withOrg });

  const response = await handleWorkspaceCreateRequest(jsonRequest(VALID_BODY), deps);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "workspace_exists" });
  assert.deepEqual(executed, []);
  assert.equal(transactions.length, 0);
  assert.deepEqual([telemetry, monitorEvents], [[], []]);
});

test("a disabled membership does not block workspace creation", async () => {
  const { sql } = makeWorkspaceSql();
  const withDisabled = {
    ...SESSION,
    memberships: [{ org_id: "org-1", status: "disabled" }],
  };
  const { deps } = makeDeps(sql, { session: withDisabled });

  const response = await handleWorkspaceCreateRequest(jsonRequest(VALID_BODY), deps);
  assert.equal(response.status, 200);
});

test("workspace happy path commits one atomic batch with threaded UUIDs", async () => {
  const { sql, calls, executed, transactions } = makeWorkspaceSql();
  const { deps, telemetry, hermesEvents, monitorEvents, hotLeadAlerts, rateLimitCalls } = makeDeps(sql);

  const response = await handleWorkspaceCreateRequest(jsonRequest(VALID_BODY), deps);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, next: "/console?view=account" });
  // The caller keeps their existing frege_session — no cookie is set here.
  assert.equal(response.headers.get("set-cookie"), null);

  assert.deepEqual(rateLimitCalls, [
    { action: "auth.workspace.create", limit: 10, windowSeconds: 60 * 60, keyParts: ["user-1"] },
  ]);

  // One transaction holding the whole provisioning write set, in order:
  // org + 3 default roles + owner membership + signups row + org_billing.
  assert.equal(transactions.length, 1);
  const batch = transactions[0];
  assert.equal(batch.length, 7);
  assert.equal(batch[0].startsWith("insert into organizations"), true);
  assert.equal(batch.filter((text) => text.startsWith("insert into roles")).length, 3);
  assert.equal(batch.some((text) => text.startsWith("insert into organization_memberships")), true);
  assert.equal(batch.some((text) => text.startsWith("insert into signups")), true);
  assert.equal(batch.some((text) => text.startsWith("insert into org_billing")), true);
  // No user/credential writes: the session user already exists (Clerk bridge).
  assert.equal(batch.some((text) => text.startsWith("insert into users")), false);
  assert.equal(batch.some((text) => text.includes("user_password_credentials")), false);

  // No write statement ever executed outside the batch.
  assert.deepEqual(
    executed.filter((call) => isWriteStatement(call.text)).map((call) => call.text),
    batch,
  );

  // Every id was pre-generated client-side and threaded consistently.
  const orgInsert = calls.find((call) => call.text.startsWith("insert into organizations"));
  const membershipInsert = calls.find((call) => call.text.startsWith("insert into organization_memberships"));
  const signupInsert = calls.find((call) => call.text.startsWith("insert into signups"));
  const billingInsert = calls.find((call) => call.text.startsWith("insert into org_billing"));
  const orgId = orgInsert.values[0];
  assert.match(orgId, UUID_RE);
  assert.deepEqual([orgInsert.values[1], orgInsert.values[2]], ["acme-ai", "Acme AI"]);
  assert.deepEqual([membershipInsert.values[0], membershipInsert.values[1]], [orgId, "user-1"]);
  assert.equal(membershipInsert.values[2], "owner");
  assert.equal(billingInsert.values[0], orgId);
  assert.deepEqual(billingInsert.values.slice(1, 4), ["team", "monthly", 3]);

  // The signups row is owned by the session user, marked qualified, and scored
  // with the neutral/lowest survey values so lead scoring stays honest.
  assert.match(signupInsert.values[0], UUID_RE);
  assert.equal(signupInsert.values[3], "Ada Lovelace");
  assert.equal(signupInsert.values[4], "ada@example.com");
  assert.equal(signupInsert.values[5], "Acme AI");
  assert.equal(signupInsert.values[6], "Not provided");
  assert.equal(signupInsert.values[7], "1-10");
  assert.equal(signupInsert.values[8], 0);
  assert.deepEqual(signupInsert.values[9], []);
  assert.equal(signupInsert.values[13], "Not provided");
  assert.equal(signupInsert.values[17], 0);
  assert.equal(signupInsert.values[18], "cold");
  assert.equal(signupInsert.values[19], "user-1");

  // Post-commit side effects: in-app monitor first, then webhook, then alert.
  assert.equal(monitorEvents.length, 1);
  assert.equal(monitorEvents[0].eventType, "frege.signup.created");
  assert.equal(monitorEvents[0].payload.signup.id, signupInsert.values[0]);
  assert.equal(monitorEvents[0].payload.signup.score, 0);
  assert.equal(monitorEvents[0].payload.signup.band, "cold");
  assert.equal(hermesEvents.length, 1);
  assert.equal(hotLeadAlerts.length, 1);
  assert.equal(hotLeadAlerts[0].lead.band, "cold");

  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].action, "auth.signup");
  assert.equal(telemetry[0].outcome, "success");
  assert.equal(telemetry[0].resourceType, "organization");
  assert.equal(telemetry[0].resourceId, orgId);
  assert.deepEqual(telemetry[0].metadata, {
    method: "social_workspace",
    org_slug: "acme-ai",
    signup_id: signupInsert.values[0],
    plan: "team-monthly",
    seats: 3,
  });
});

test("an existing signups row is marked qualified in-batch without losing survey answers", async () => {
  const existingSignupRow = { signup_id: "signup-9" };
  const { sql, calls, transactions } = makeWorkspaceSql({ existingSignupRow });
  const { deps, monitorEvents, hotLeadAlerts } = makeDeps(sql);

  const response = await handleWorkspaceCreateRequest(jsonRequest(VALID_BODY), deps);
  assert.equal(response.status, 200);

  const batch = transactions[0];
  assert.equal(batch.some((text) => text.startsWith("update signups")), true);
  assert.equal(batch.some((text) => text.startsWith("insert into signups")), false);

  // The update only claims the row (status/qualified_at/owner_user_id).
  const signupUpdate = calls.find((call) => call.text.startsWith("update signups"));
  assert.deepEqual(signupUpdate.values, ["user-1", "signup-9"]);

  // Monitor payload + alert are rebuilt from the row's ORIGINAL survey answers
  // (a genuinely hot lead stays hot even though this flow collected nothing).
  assert.equal(monitorEvents[0].payload.signup.id, "signup-9");
  assert.equal(monitorEvents[0].payload.signup.company, "Original Company");
  assert.equal(monitorEvents[0].payload.signup.band, "hot");
  assert.equal(hotLeadAlerts[0].lead.band, "hot");
  assert.equal(hotLeadAlerts[0].signup.decision_timeline, "Now");
});

test("partial batch failure returns workspace_failed and runs no side effects", async () => {
  const { sql, transactions } = makeWorkspaceSql({ failOnText: "insert into org_billing" });
  const { deps, telemetry, monitorEvents, hermesEvents, hotLeadAlerts } = makeDeps(sql);

  const response = await handleWorkspaceCreateRequest(jsonRequest(VALID_BODY), deps);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "workspace_failed" });
  assert.equal(transactions.length, 1);
  // The transaction rejected, so nothing after it may run: telemetry, monitor,
  // webhook, and alert are all post-commit only.
  assert.deepEqual([telemetry, monitorEvents, hermesEvents, hotLeadAlerts], [[], [], [], []]);
});

test("a 23505 raised inside the batch (concurrent creation) maps to workspace_exists", async () => {
  const { sql } = makeWorkspaceSql({ failOnText: "insert into organization_memberships", failCode: "23505" });
  const { deps, telemetry, monitorEvents } = makeDeps(sql);

  const response = await handleWorkspaceCreateRequest(jsonRequest(VALID_BODY), deps);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "workspace_exists" });
  assert.deepEqual([telemetry, monitorEvents], [[], []]);
});

test("rate limited workspace create returns 429 before touching the database", async () => {
  const { sql, executed, transactions } = makeWorkspaceSql();
  const { deps } = makeDeps(sql, {
    overrides: {
      checkRateLimit: async () => ({ allowed: false, attempts: 11, limit: 10, retryAfterSeconds: 3600 }),
    },
  });

  const response = await handleWorkspaceCreateRequest(jsonRequest(VALID_BODY), deps);
  assert.equal(response.status, 429);
  assert.deepEqual(executed, []);
  assert.equal(transactions.length, 0);
});

test("invalid payloads return the validation envelope", async () => {
  const { sql, executed } = makeWorkspaceSql();
  const { deps } = makeDeps(sql);

  const response = await handleWorkspaceCreateRequest(jsonRequest({ org_name: "", plan: "solo" }), deps);
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, "validation");
  assert.equal(Boolean(body.fieldErrors.org_name), true);
  assert.deepEqual(executed, []);
});

test("solo plan defaults land as 1 monthly seat in org_billing", async () => {
  const { sql, calls } = makeWorkspaceSql();
  const { deps, telemetry } = makeDeps(sql);

  const response = await handleWorkspaceCreateRequest(jsonRequest({ org_name: "Solo Shop" }), deps);
  assert.equal(response.status, 200);
  const billingInsert = calls.find((call) => call.text.startsWith("insert into org_billing"));
  assert.deepEqual(billingInsert.values.slice(1, 4), ["solo", "monthly", 1]);
  assert.equal(telemetry[0].metadata.plan, "solo");
  assert.equal(telemetry[0].metadata.seats, 1);
});
