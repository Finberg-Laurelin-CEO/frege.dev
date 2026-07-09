#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// auth-flow-core.ts and keys.ts import shared modules through the TypeScript "@/"
// path alias, which plain `node --test` cannot resolve. Register the same resolve
// hook as test-agent-runtime.mjs mapping "@/<x>" -> <repoRoot>/<x>. request-guards
// pulls in "@/lib/core/session" (only for assertSafeBrowserMutation, unused here);
// stub it so the test stays hermetic and never loads the DB driver. The project
// modules are imported dynamically AFTER the hooks are registered.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VIRTUAL = {
  "@/lib/core/session": "export const readSessionToken = () => null;",
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

const { handleInviteAcceptRequest, handleLoginRequest } = await import("../../lib/core/auth-flow-core.ts");
const {
  generateApiKey,
  hashApiKey,
  parseApiKey,
  parseStaffApiKey,
  safelyCompareApiKeyHash,
} = await import("../../lib/core/keys.ts");
const { hashPassword, verifyPassword } = await import("../../lib/core/password.ts");
const { clearSessionCookie, cookieDomainForHost, sessionCookie } = await import("../../lib/core/session-cookie.ts");

const TEST_PASSWORD = "correct horse battery staple";
const TEST_SALT = "00112233445566778899aabbccddeeff";

function jsonRequest(path, host, body) {
  return new Request(`https://${host}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: host,
      Origin: `https://${host}`,
    },
    body: JSON.stringify(body),
  });
}

function queryText(strings) {
  return strings.join(" ").replace(/\s+/g, " ").trim();
}

function makeDeps(sql, overrides = {}) {
  const telemetry = [];
  const sessions = [];
  const deps = {
    getSql: () => sql,
    checkRateLimit: async () => ({ allowed: true }),
    rateLimitedResponse: () => Response.json({ error: "rate_limited" }, { status: 429 }),
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
    routeError: (label, err) => {
      throw new Error(`${label}: ${err?.message ?? err}`);
    },
    verifyPassword,
    hashPassword,
    ...overrides,
  };
  return { deps, telemetry, sessions };
}

function makeLoginSql(row) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = queryText(strings);
    calls.push({ text, values });
    if (text.includes("select users.id")) return row ? [row] : [];
    if (text.includes("update users set last_login_at")) return [];
    throw new Error(`unexpected login SQL: ${text}`);
  };
  return { sql, calls };
}

// Neon-like fake: sql`...` builds a LAZY statement (recorded in `calls`) that
// only executes when awaited — directly (reads) or via sql.transaction (writes).
// `executed` tracks actual execution; `transactions` the batched statement texts.
function makeInviteSql({ invite, existingUser = null, credentialExists = false, failOnText = null }) {
  const calls = [];
  const executed = [];
  const transactions = [];
  const createdUser = { id: "user-new", email: invite.email, name: "Ada Lovelace" };
  const updatedUser = { id: existingUser?.id ?? "user-existing", email: invite.email, name: existingUser?.name || "Ada Lovelace" };

  const run = (text, values) => {
    executed.push({ text, values });
    if (failOnText && text.includes(failOnText)) throw new Error(`forced failure: ${failOnText}`);
    if (text.includes("from organization_invites")) return [invite];
    if (text.includes("from users where email")) return existingUser ? [existingUser] : [];
    if (text.includes("insert into users")) return [createdUser];
    if (text.includes("update users set name")) return [updatedUser];
    if (text.includes("from user_password_credentials")) {
      return credentialExists ? [{ user_id: existingUser?.id ?? createdUser.id }] : [];
    }
    if (text.includes("insert into user_password_credentials")) return [];
    if (text.includes("insert into organization_memberships")) return [];
    if (text.includes("update organization_invites")) return [];
    throw new Error(`unexpected invite SQL: ${text}`);
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
  return { sql, calls, executed, transactions, createdUser, updatedUser };
}

function isWriteStatement(text) {
  return text.startsWith("insert into") || text.startsWith("update");
}

async function readJson(response) {
  return response.json();
}

test("password hashing verifies the original password and rejects mismatches", async () => {
  const result = await hashPassword(TEST_PASSWORD, TEST_SALT);

  assert.equal(result.passwordSalt, TEST_SALT);
  assert.equal(result.passwordParams.algorithm, "scrypt");
  assert.equal(result.passwordParams.key_length, 64);
  assert.match(result.passwordHash, /^[a-f0-9]{128}$/);
  assert.equal(await verifyPassword(TEST_PASSWORD, result.passwordSalt, result.passwordHash), true);
  assert.equal(await verifyPassword("wrong password", result.passwordSalt, result.passwordHash), false);
  assert.equal(await verifyPassword(TEST_PASSWORD, result.passwordSalt, "00"), false);
});

test("session cookies use frege.dev parent domain only for frege.dev hosts", () => {
  assert.equal(cookieDomainForHost("frege.dev"), ".frege.dev");
  assert.equal(cookieDomainForHost("brain.frege.dev"), ".frege.dev");
  assert.equal(cookieDomainForHost("BRAIN.FREGE.DEV:443"), ".frege.dev");
  assert.equal(cookieDomainForHost("localhost:3000"), null);
  assert.equal(cookieDomainForHost("frege-git-preview.vercel.app"), null);

  assert.match(sessionCookie("token", "frege.dev"), /Domain=\.frege\.dev/);
  assert.match(clearSessionCookie("brain.frege.dev"), /Domain=\.frege\.dev/);
  assert.doesNotMatch(sessionCookie("token", "localhost:3000"), /Domain=/);
  assert.doesNotMatch(sessionCookie("token", "frege-git-preview.vercel.app"), /Domain=/);
});

test("login success returns user shape and session cookie", async () => {
  const password = await hashPassword(TEST_PASSWORD, TEST_SALT);
  const { sql, calls } = makeLoginSql({
    id: "user-1",
    email: "ada@example.com",
    name: "Ada",
    password_hash: password.passwordHash,
    password_salt: password.passwordSalt,
  });
  const { deps, telemetry, sessions } = makeDeps(sql);

  const response = await handleLoginRequest(
    jsonRequest("/api/v1/auth/login", "brain.frege.dev", {
      email: "ADA@example.com",
      password: TEST_PASSWORD,
    }),
    deps,
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, { user: { id: "user-1", email: "ada@example.com", name: "Ada" } });
  assert.match(response.headers.get("set-cookie") ?? "", /Domain=\.frege\.dev/);
  assert.deepEqual(sessions, [{ userId: "user-1", host: "brain.frege.dev" }]);
  assert.equal(telemetry.at(-1)?.outcome, "success");
  assert.equal(calls.some((call) => call.text.includes("last_login_at")), true);
});

test("login failure returns invalid_credentials and does not create a session", async () => {
  const password = await hashPassword(TEST_PASSWORD, TEST_SALT);
  const { sql, calls } = makeLoginSql({
    id: "user-1",
    email: "ada@example.com",
    name: "Ada",
    password_hash: password.passwordHash,
    password_salt: password.passwordSalt,
  });
  const { deps, telemetry, sessions } = makeDeps(sql);

  const response = await handleLoginRequest(
    jsonRequest("/api/v1/auth/login", "localhost:3000", {
      email: "ada@example.com",
      password: "not the password",
    }),
    deps,
  );
  const body = await readJson(response);

  assert.equal(response.status, 401);
  assert.deepEqual(body, { error: "invalid_credentials" });
  assert.deepEqual(sessions, []);
  assert.equal(telemetry.at(-1)?.outcome, "denied");
  assert.equal(calls.some((call) => call.text.includes("last_login_at")), false);
});

test("invite acceptance creates user credentials and activates membership", async () => {
  const invite = {
    id: "invite-1",
    org_id: "org-1",
    org_slug: "acme",
    org_name: "Acme",
    org_status: "active",
    email: "new.user@example.com",
    role: "member",
  };
  const { sql, calls, executed, transactions } = makeInviteSql({ invite });
  const { deps, sessions } = makeDeps(sql);

  const response = await handleInviteAcceptRequest(
    jsonRequest("/api/v1/auth/invites/accept", "frege.dev", {
      token: "invite-token-with-enough-length",
      name: " Ada Lovelace ",
      password: "long-enough-password",
    }),
    deps,
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.user.email, invite.email);
  assert.equal(body.organization.slug, "acme");
  assert.equal(body.next_path, "/admin");
  assert.deepEqual(sessions, [{ userId: "user-new", host: "frege.dev" }]);
  assert.equal(calls.some((call) => call.text.includes("insert into users")), true);
  assert.equal(calls.some((call) => call.text.includes("insert into user_password_credentials")), true);
  assert.equal(calls.some((call) => call.text.includes("insert into organization_memberships")), true);

  // Every write ran inside exactly one atomic batch — none outside it.
  assert.equal(transactions.length, 1);
  assert.deepEqual(
    executed.filter((call) => isWriteStatement(call.text)).map((call) => call.text),
    transactions[0],
  );
  assert.equal(transactions[0].some((text) => text.includes("update organization_invites")), true);
  // The new user's id is pre-generated client-side (non-interactive batch).
  const userInsert = calls.find((call) => call.text.includes("insert into users"));
  assert.match(String(userInsert.values[0]), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const membershipInsert = calls.find((call) => call.text.includes("insert into organization_memberships"));
  assert.equal(membershipInsert.values[1], userInsert.values[0]);
});

test("invite acceptance partial failure runs no side effects after rollback", async () => {
  const invite = {
    id: "invite-3",
    org_id: "org-3",
    org_slug: "acme",
    org_name: "Acme",
    org_status: "active",
    email: "new.user@example.com",
    role: "member",
  };
  const { sql, executed, transactions } = makeInviteSql({
    invite,
    failOnText: "insert into organization_memberships",
  });
  const { deps, telemetry, sessions } = makeDeps(sql, {
    routeError: () => Response.json({ error: "internal" }, { status: 500 }),
  });

  const response = await handleInviteAcceptRequest(
    jsonRequest("/api/v1/auth/invites/accept", "frege.dev", {
      token: "invite-token-with-enough-length",
      name: "Ada Lovelace",
      password: "long-enough-password",
    }),
    deps,
  );
  const body = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepEqual(body, { error: "internal" });
  // The batch was attempted once and rejected; no session, telemetry, or
  // invite-status update escaped it.
  assert.equal(transactions.length, 1);
  assert.deepEqual(sessions, []);
  assert.deepEqual(telemetry, []);
  assert.equal(executed.some((call) => call.text.includes("update organization_invites")), false);
});

test("inactive owner/admin invite acceptance routes to account onboarding", async () => {
  const invite = {
    id: "invite-2",
    org_id: "org-2",
    org_slug: "inactive-co",
    org_name: "Inactive Co",
    org_status: "inactive",
    email: "owner@example.com",
    role: "admin",
  };
  const existingUser = { id: "user-existing", email: invite.email, name: "" };
  const { sql, calls, transactions } = makeInviteSql({ invite, existingUser, credentialExists: true });
  const { deps } = makeDeps(sql);

  const response = await handleInviteAcceptRequest(
    jsonRequest("/api/v1/auth/invites/accept", "brain.frege.dev", {
      token: "inactive-owner-token-value",
      name: "Owner Name",
      password: "long-enough-password",
    }),
    deps,
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.next_path, "/console?view=account");
  assert.equal(body.organization.status, "inactive");
  assert.equal(calls.some((call) => call.text.includes("update users set name")), true);
  assert.equal(calls.some((call) => call.text.includes("insert into user_password_credentials")), false);
  assert.equal(calls.some((call) => call.text.includes("insert into organization_memberships")), true);
  assert.equal(transactions.length, 1);
});

test("API key create/use/revoke mechanics and staff key boundaries stay separate", () => {
  const salt = "test-api-key-salt";
  const generated = generateApiKey(salt);
  const keyRecord = {
    key_prefix: generated.keyPrefix,
    key_hash: generated.keyHash,
    status: "active",
  };

  function authenticate(rawKey) {
    const parsed = parseApiKey(rawKey);
    if (!parsed || parsed.keyPrefix !== keyRecord.key_prefix) return false;
    if (keyRecord.status !== "active") return false;
    return safelyCompareApiKeyHash(hashApiKey(parsed.rawKey, salt), keyRecord.key_hash);
  }

  assert.match(generated.rawKey, /^frg_live_[a-f0-9]{12}_.+/);
  assert.equal(authenticate(generated.rawKey), true);
  assert.equal(authenticate(`${generated.rawKey}x`), false);

  keyRecord.status = "revoked";
  assert.equal(authenticate(generated.rawKey), false);

  assert.equal(parseApiKey("frg_admin_abcdef123456_secret"), null);
  assert.equal(parseStaffApiKey(generated.rawKey), null);
});
