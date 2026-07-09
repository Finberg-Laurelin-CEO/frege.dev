#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// signup-flow-core.ts imports shared modules through the TypeScript "@/" path
// alias; register the same resolve hook as test-auth-flow.mjs mapping
// "@/<x>" -> <repoRoot>/<x>. Two modules are stubbed to keep the test hermetic:
// - "@/lib/core/session": request-guards pulls it in for assertSafeBrowserMutation
//   (unused here) and it would load the DB driver.
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

const { handleSignupRequest } = await import("../../lib/core/signup-flow-core.ts");
const { hashPassword } = await import("../../lib/core/password.ts");
const { sessionCookie } = await import("../../lib/core/session-cookie.ts");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function jsonRequest(body) {
  const host = "frege.dev";
  return new Request(`https://${host}/api/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: host,
      Origin: `https://${host}`,
      "User-Agent": "signup-test",
    },
    body: JSON.stringify(body),
  });
}

function validSignupBody(overrides = {}) {
  return {
    name: "Ada Lovelace",
    work_email: "Ada@Example.com",
    company: "Acme AI",
    company_size: "11-50",
    permission_to_contact: true,
    password: "correct horse battery staple",
    confirm_password: "correct horse battery staple",
    plan: "team-monthly",
    seats: 3,
    started_at: Date.now(),
    ...overrides,
  };
}

function queryText(strings) {
  return strings.join(" ").replace(/\s+/g, " ").trim();
}

function isWriteStatement(text) {
  return text.startsWith("insert into") || text.startsWith("update");
}

// Neon-like fake: sql`...` builds a LAZY statement that only executes when
// awaited — directly (the flow's reads) or inside sql.transaction (the atomic
// batch). `executed` records real execution so the tests can prove that no
// write ever runs outside the single transaction.
function makeSignupSql({ existingUserRow = null, existingSignupRow = null, failOnText = null, failCode = null } = {}) {
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
    if (text.includes("select id from users")) return existingUserRow ? [existingUserRow] : [];
    if (text.includes("from signups s")) return existingSignupRow ? [existingSignupRow] : [];
    if (text.includes("select 1 from organizations where slug")) return [];
    if (text.includes("insert into signups") || text.includes("update signups")) {
      return [
        {
          id: text.includes("update signups") ? existingSignupRow?.signup_id : values[0],
          created_at: new Date("2026-07-01T00:00:00.000Z"),
          name: "Ada Lovelace",
          work_email: "ada@example.com",
          company: "Acme AI",
          role: "Not provided",
          company_size: "11-50",
          expected_users: 0,
          current_agent_tools: [],
          other_tool: "",
          monthly_ai_spend: "Not provided",
          willing_to_pay: "Not provided",
          decision_timeline: "Not provided",
          main_pain_point: "Pilot access request",
          other_comments: "",
        },
      ];
    }
    if (isWriteStatement(text)) return [];
    throw new Error(`unexpected signup SQL: ${text}`);
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

function makeDeps(sql, overrides = {}) {
  const telemetry = [];
  const sessions = [];
  const welcomeEmails = [];
  const verificationEmails = [];
  const hermesEvents = [];
  const deps = {
    getSql: () => sql,
    checkRateLimit: async () => ({ allowed: true, attempts: 1, limit: 5, retryAfterSeconds: 0 }),
    rateLimitedResponse: () => Response.json({ error: "rate_limited" }, { status: 429 }),
    hashPassword,
    createUserSession: async (userId, host) => {
      sessions.push({ userId, host });
      return {
        rawToken: `raw-${userId}`,
        cookie: sessionCookie(`raw-${userId}`, host),
        expiresAt: new Date(Date.now() + 1000),
      };
    },
    logTelemetryEvent: async (event) => {
      telemetry.push(event);
    },
    sendSignupWelcomeEmail: async (input) => {
      welcomeEmails.push(input);
      return { sent: true };
    },
    sendEmailVerificationEmail: async (input) => {
      verificationEmails.push(input);
      return { sent: true };
    },
    postHermesEvent: async (payload) => {
      hermesEvents.push(payload);
      return { ok: true };
    },
    ...overrides,
  };
  return { deps, telemetry, sessions, welcomeEmails, verificationEmails, hermesEvents };
}

async function readJson(response) {
  return response.json();
}

test("signup happy path commits one atomic batch and keeps the response shape", async () => {
  const { sql, calls, executed, transactions } = makeSignupSql();
  const { deps, telemetry, sessions, welcomeEmails, verificationEmails, hermesEvents } = makeDeps(sql);

  const response = await handleSignupRequest(jsonRequest(validSignupBody()), deps);
  const body = await readJson(response);

  assert.equal(response.status, 201);
  assert.match(body.id, UUID_RE);
  assert.match(body.user.id, UUID_RE);
  assert.equal(body.user.email, "ada@example.com");
  assert.equal(body.user.name, "Ada Lovelace");
  assert.match(body.organization.id, UUID_RE);
  assert.equal(body.organization.slug, "acme-ai");
  assert.equal(body.organization.name, "Acme AI");
  assert.equal(body.organization.status, "inactive");
  assert.equal(body.email_sent, true);
  assert.equal(body.next_path, "/console?view=account");
  assert.match(response.headers.get("set-cookie") ?? "", /Domain=\.frege\.dev/);

  // One transaction holding the whole onboarding write set, in order.
  assert.equal(transactions.length, 1);
  const batch = transactions[0];
  assert.equal(batch.length, 10);
  assert.equal(batch[0].startsWith("insert into organizations"), true);
  assert.equal(batch.filter((text) => text.startsWith("insert into roles")).length, 3);
  assert.equal(batch.some((text) => text.startsWith("insert into users")), true);
  assert.equal(batch.some((text) => text.startsWith("insert into user_password_credentials")), true);
  assert.equal(batch.some((text) => text.startsWith("insert into organization_memberships")), true);
  assert.equal(batch.some((text) => text.startsWith("insert into signups")), true);
  assert.equal(batch.some((text) => text.startsWith("insert into org_billing")), true);
  assert.equal(batch.some((text) => text.startsWith("insert into email_verification_tokens")), true);
  // No invite to accept on the fresh-signup path.
  assert.equal(batch.some((text) => text.includes("organization_invites")), false);

  // No write statement ever executed outside the batch.
  assert.deepEqual(
    executed.filter((call) => isWriteStatement(call.text)).map((call) => call.text),
    batch,
  );

  // Every id was pre-generated client-side and threaded consistently.
  const orgInsert = calls.find((call) => call.text.startsWith("insert into organizations"));
  const userInsert = calls.find((call) => call.text.startsWith("insert into users"));
  const membershipInsert = calls.find((call) => call.text.startsWith("insert into organization_memberships"));
  const tokenInsert = calls.find((call) => call.text.startsWith("insert into email_verification_tokens"));
  assert.equal(orgInsert.values[0], body.organization.id);
  assert.equal(userInsert.values[0], body.user.id);
  assert.deepEqual([membershipInsert.values[0], membershipInsert.values[1]], [body.organization.id, body.user.id]);
  assert.equal(membershipInsert.values[2], "owner");
  assert.equal(tokenInsert.values[0], body.user.id);

  // Post-commit side effects all ran, with the session for the new user.
  assert.equal(hermesEvents.length, 1);
  assert.equal(hermesEvents[0].event, "frege.signup.created");
  assert.equal(hermesEvents[0].signup.id, body.id);
  assert.deepEqual(welcomeEmails, [
    {
      to: "ada@example.com",
      name: "Ada Lovelace",
      orgName: "Acme AI",
      accountUrl: "https://brain.frege.dev/console?view=account",
    },
  ]);
  assert.equal(verificationEmails.length, 1);
  assert.match(verificationEmails[0].verificationUrl, /\/api\/v1\/auth\/email\/verification\/confirm\?token=/);
  assert.deepEqual(sessions, [{ userId: body.user.id, host: "frege.dev" }]);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].action, "auth.signup");
  assert.equal(telemetry[0].outcome, "success");
  assert.deepEqual(telemetry[0].metadata, {
    org_slug: "acme-ai",
    signup_id: body.id,
    reused_invite: false,
    welcome_email_sent: true,
    verification_email_sent: true,
    plan: "team-monthly",
    seats: 3,
  });
});

test("signup with a pending invite reuses the org and accepts the invite in the batch", async () => {
  const existingSignupRow = {
    signup_id: "signup-1",
    invite_id: "invite-1",
    invite_status: "pending",
    invite_role: "admin",
    org_id: "org-1",
    org_slug: "acme",
    org_name: "Acme",
    org_status: "active",
  };
  const { sql, calls, transactions } = makeSignupSql({ existingSignupRow });
  const { deps, telemetry } = makeDeps(sql);

  const response = await handleSignupRequest(jsonRequest(validSignupBody()), deps);
  const body = await readJson(response);

  assert.equal(response.status, 201);
  assert.equal(body.id, "signup-1");
  assert.deepEqual(body.organization, { id: "org-1", slug: "acme", name: "Acme", status: "active" });

  assert.equal(transactions.length, 1);
  const batch = transactions[0];
  // Reused org: no organizations insert; signups row is updated, not inserted.
  assert.equal(batch.some((text) => text.startsWith("insert into organizations")), false);
  assert.equal(batch.some((text) => text.startsWith("update signups")), true);
  assert.equal(batch.some((text) => text.startsWith("insert into signups")), false);
  assert.equal(batch.some((text) => text.startsWith("update organization_invites")), true);
  const membershipInsert = calls.find((call) => call.text.startsWith("insert into organization_memberships"));
  assert.equal(membershipInsert.values[2], "admin");
  assert.equal(telemetry[0].metadata.reused_invite, true);
});

test("duplicate email is rejected before any write with account_exists", async () => {
  const { sql, executed, transactions } = makeSignupSql({ existingUserRow: { id: "user-1" } });
  const { deps, telemetry, sessions, welcomeEmails, verificationEmails, hermesEvents } = makeDeps(sql);

  const response = await handleSignupRequest(jsonRequest(validSignupBody()), deps);
  const body = await readJson(response);

  assert.equal(response.status, 409);
  assert.deepEqual(body, {
    error: "account_exists",
    recovery: { action: "sign_in", requested_at: null },
  });
  assert.equal(transactions.length, 0);
  assert.equal(executed.some((call) => isWriteStatement(call.text)), false);
  assert.deepEqual([sessions, telemetry, welcomeEmails, verificationEmails, hermesEvents], [[], [], [], [], []]);
});

test("a 23505 raised inside the batch (duplicate race) still maps to account_exists", async () => {
  const { sql, transactions } = makeSignupSql({ failOnText: "insert into users", failCode: "23505" });
  const { deps, telemetry, sessions, welcomeEmails, verificationEmails, hermesEvents } = makeDeps(sql);

  const response = await handleSignupRequest(jsonRequest(validSignupBody()), deps);
  const body = await readJson(response);

  assert.equal(response.status, 409);
  assert.deepEqual(body, {
    error: "account_exists",
    recovery: { action: "sign_in", requested_at: null },
  });
  assert.equal(transactions.length, 1);
  // Rolled back: no side effect (webhook, email, session, telemetry) ran.
  assert.deepEqual([sessions, telemetry, welcomeEmails, verificationEmails, hermesEvents], [[], [], [], [], []]);
});

test("partial batch failure returns signup_failed and runs no side effects", async () => {
  const { sql, transactions } = makeSignupSql({ failOnText: "insert into org_billing" });
  const { deps, telemetry, sessions, welcomeEmails, verificationEmails, hermesEvents } = makeDeps(sql);

  const response = await handleSignupRequest(jsonRequest(validSignupBody()), deps);
  const body = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepEqual(body, { error: "signup_failed" });
  assert.equal(transactions.length, 1);
  // The transaction rejected, so nothing after it may run: no orphaned
  // side effects (and, with a real driver, no orphaned rows).
  assert.deepEqual([sessions, telemetry, welcomeEmails, verificationEmails, hermesEvents], [[], [], [], [], []]);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("honeypot submissions return 200 with a null id and touch nothing", async () => {
  const { sql, executed, transactions } = makeSignupSql();
  const { deps, telemetry, sessions, welcomeEmails, verificationEmails, hermesEvents } = makeDeps(sql);

  const response = await handleSignupRequest(
    jsonRequest(validSignupBody({ company_url: "https://spam.example.com" })),
    deps,
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, { id: null, next_path: "/thanks" });
  assert.deepEqual(executed, []);
  assert.equal(transactions.length, 0);
  assert.deepEqual([sessions, telemetry, welcomeEmails, verificationEmails, hermesEvents], [[], [], [], [], []]);
});

test("rate limited signup returns 429 before touching the database", async () => {
  const { sql, executed, transactions } = makeSignupSql();
  const { deps } = makeDeps(sql, {
    checkRateLimit: async () => ({ allowed: false, attempts: 6, limit: 5, retryAfterSeconds: 3600 }),
  });

  const response = await handleSignupRequest(jsonRequest(validSignupBody()), deps);
  const body = await readJson(response);

  assert.equal(response.status, 429);
  assert.deepEqual(body, { error: "rate_limited" });
  assert.deepEqual(executed, []);
  assert.equal(transactions.length, 0);
});

test("invalid payloads return the validation envelope", async () => {
  const { sql, executed } = makeSignupSql();
  const { deps } = makeDeps(sql);

  const response = await handleSignupRequest(
    jsonRequest(validSignupBody({ work_email: "not-an-email" })),
    deps,
  );
  const body = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, "validation");
  assert.equal(Boolean(body.fieldErrors.work_email), true);
  assert.deepEqual(executed, []);
});
