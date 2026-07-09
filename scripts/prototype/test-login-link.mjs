#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// login-link.ts imports shared modules through the TypeScript "@/" path alias;
// register the same resolve hook as test-clerk-auth.mjs mapping
// "@/<x>" -> <repoRoot>/<x>. Two modules are stubbed to keep the test hermetic:
// - "@/lib/core/session": request-guards pulls it in for assertSafeBrowserMutation
//   (readSessionToken only) and it would load the DB driver.
// - "@/lib/db": type-only import in login-link.ts; the stub guarantees no
//   driver ever loads.
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

const {
  LOGIN_LINK_EXPIRES_SECONDS,
  handleLoginLinkConfirm,
  handleLoginLinkRequest,
  hashLoginLinkToken,
} = await import("../../lib/core/login-link.ts");
const { sessionCookie } = await import("../../lib/core/session-cookie.ts");

const HOST = "brain.frege.dev";

function requestLink(body, { host = HOST, origin = `https://${host}` } = {}) {
  return new Request(`https://${host}/api/v1/auth/login-link/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: host,
      ...(origin ? { Origin: origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function confirmLink(query, { host = HOST } = {}) {
  return new Request(`https://${host}/api/v1/auth/login-link/confirm${query}`, {
    method: "GET",
    headers: { Host: host },
  });
}

function queryText(strings) {
  return strings.join(" ").replace(/\s+/g, " ").trim();
}

// Minimal stateful fake for the login-link SQL surface. `executed` records
// every statement so tests can prove what did (not) touch the database.
function makeLoginLinkSql({ userRow = null, tokenRow = null, loseUsedRace = false, throwOn = null } = {}) {
  const executed = [];
  const sql = async (strings, ...values) => {
    const text = queryText(strings);
    executed.push({ text, values });
    if (throwOn && text.includes(throwOn)) throw new Error(`forced failure: ${throwOn}`);
    if (text.startsWith("select id, email, name from users")) return userRow ? [userRow] : [];
    if (text.startsWith("insert into login_link_tokens")) return [];
    if (text.includes("from login_link_tokens join users")) return tokenRow ? [tokenRow] : [];
    if (text.startsWith("update login_link_tokens set used_at")) {
      return loseUsedRace ? [] : [{ id: tokenRow?.id ?? "tok-1" }];
    }
    if (text.startsWith("update users set last_login_at")) return [];
    throw new Error(`unexpected login-link SQL: ${text}`);
  };
  return { sql, executed };
}

function makeDeps(sql, overrides = {}) {
  const telemetry = [];
  const sessions = [];
  const emails = [];
  const rateLimitCalls = [];
  const deps = {
    getSql: () => sql,
    checkRateLimit: async (req, input) => {
      rateLimitCalls.push(input);
      return { allowed: true, attempts: 1, limit: input.limit, retryAfterSeconds: input.windowSeconds };
    },
    rateLimitedResponse: (limit) =>
      Response.json(
        { error: "rate_limited", retry_after_seconds: limit.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      ),
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
    sendLoginLinkEmail: async (input) => {
      emails.push(input);
      return { sent: true };
    },
    routeError: () => Response.json({ error: "internal" }, { status: 500 }),
    ...overrides,
  };
  return { deps, telemetry, sessions, emails, rateLimitCalls };
}

const ACTIVE_USER = { id: "user-1", email: "ada@example.com", name: "Ada Lovelace" };
const TOKEN_ROW = { id: "tok-1", user_id: "user-1", email: "ada@example.com" };

// ── Request ──────────────────────────────────────────────────────────────────

test("login link request is enumeration-safe for unknown emails", async () => {
  const { sql, executed } = makeLoginLinkSql({ userRow: null });
  const { deps, emails, telemetry } = makeDeps(sql);

  const response = await handleLoginLinkRequest(requestLink({ email: "nobody@example.com" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  // The same 200 as the success path: no token insert, no email, no telemetry.
  assert.equal(executed.some((call) => call.text.startsWith("insert into")), false);
  assert.deepEqual(emails, []);
  assert.deepEqual(telemetry, []);
});

test("login link request stores a sha256 hash and emails the raw token", async () => {
  const { sql, executed } = makeLoginLinkSql({ userRow: ACTIVE_USER });
  const { deps, emails, telemetry } = makeDeps(sql);

  const before = Date.now();
  const response = await handleLoginLinkRequest(requestLink({ email: "Ada@Example.com" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const insert = executed.find((call) => call.text.startsWith("insert into login_link_tokens"));
  assert.equal(insert.values[0], "user-1");

  // The emailed link carries the raw token; only its sha256 hash is stored.
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, "ada@example.com");
  assert.equal(emails[0].name, "Ada Lovelace");
  const loginUrl = new URL(emails[0].loginUrl);
  assert.equal(loginUrl.pathname, "/api/v1/auth/login-link/confirm");
  const rawToken = loginUrl.searchParams.get("token");
  assert.equal(rawToken.length > 16, true);
  assert.notEqual(insert.values[1], rawToken);
  assert.equal(insert.values[1], createHash("sha256").update(rawToken).digest("hex"));
  assert.equal(insert.values[1], hashLoginLinkToken(rawToken));

  // 15-minute expiry.
  const expiresAt = new Date(insert.values[2]).getTime();
  assert.equal(LOGIN_LINK_EXPIRES_SECONDS, 15 * 60);
  assert.equal(expiresAt >= before + 14 * 60 * 1000, true);
  assert.equal(expiresAt <= Date.now() + 16 * 60 * 1000, true);

  const event = telemetry.at(-1);
  assert.equal(event?.action, "auth.login_link.request");
  assert.equal(event?.outcome, "success");
  assert.equal(event?.resourceId, "user-1");
  assert.deepEqual(event?.metadata, { email_sent: true });
});

test("login link request carries a validated next path into the emailed link", async () => {
  const { sql } = makeLoginLinkSql({ userRow: ACTIVE_USER });
  const { deps, emails } = makeDeps(sql);

  await handleLoginLinkRequest(
    requestLink({ email: "ada@example.com", next: "/console?view=account" }),
    deps,
  );
  assert.equal(new URL(emails[0].loginUrl).searchParams.get("next"), "/console?view=account");

  const hostile = makeDeps(makeLoginLinkSql({ userRow: ACTIVE_USER }).sql);
  await handleLoginLinkRequest(
    requestLink({ email: "ada@example.com", next: "https://evil.com/phish" }),
    hostile.deps,
  );
  assert.equal(new URL(hostile.emails[0].loginUrl).searchParams.get("next"), null);
});

test("login link request mirrors the password-reset rate limits (5/email/hour + 20/ip/hour)", async () => {
  const { sql } = makeLoginLinkSql({ userRow: ACTIVE_USER });
  const { deps, rateLimitCalls } = makeDeps(sql);

  await handleLoginLinkRequest(requestLink({ email: "ada@example.com" }), deps);
  assert.deepEqual(rateLimitCalls, [
    {
      action: "auth.login_link.request.email",
      limit: 5,
      windowSeconds: 60 * 60,
      keyParts: ["ada@example.com"],
    },
    {
      action: "auth.login_link.request.ip",
      limit: 20,
      windowSeconds: 60 * 60,
    },
  ]);
});

test("rate limited login link request returns 429 before touching the database", async () => {
  const { sql, executed } = makeLoginLinkSql({ userRow: ACTIVE_USER });
  const { deps, emails } = makeDeps(sql, {
    checkRateLimit: async () => ({ allowed: false, attempts: 6, limit: 5, retryAfterSeconds: 3600 }),
  });

  const response = await handleLoginLinkRequest(requestLink({ email: "ada@example.com" }), deps);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "rate_limited", retry_after_seconds: 3600 });
  assert.deepEqual(executed, []);
  assert.deepEqual(emails, []);
});

test("login link request validates the payload and rejects cross-origin posts", async () => {
  const { sql, executed } = makeLoginLinkSql({ userRow: ACTIVE_USER });

  const invalid = makeDeps(sql);
  const invalidResponse = await handleLoginLinkRequest(requestLink({ email: "not-an-email" }), invalid.deps);
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).error, "validation");

  const hostile = makeDeps(sql);
  const hostileResponse = await handleLoginLinkRequest(
    requestLink({ email: "ada@example.com" }, { origin: "https://evil.com" }),
    hostile.deps,
  );
  assert.equal(hostileResponse.status, 403);
  assert.deepEqual(await hostileResponse.json(), { error: "forbidden_origin" });
  assert.deepEqual(executed, []);
});

// ── Confirm ──────────────────────────────────────────────────────────────────

function setCookies(response) {
  return response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get("set-cookie")];
}

test("login link confirm marks the token used and mints a frege_session", async () => {
  const { sql, executed } = makeLoginLinkSql({ tokenRow: TOKEN_ROW });
  const { deps, sessions, telemetry } = makeDeps(sql);

  const response = await handleLoginLinkConfirm(confirmLink("?token=raw-token-value-1234"), deps);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/console");

  const cookies = setCookies(response);
  assert.equal(cookies.some((cookie) => cookie.startsWith("frege_session=")), true);
  assert.deepEqual(sessions, [{ userId: "user-1", host: HOST }]);

  // The lookup is by sha256 hash; the guarded update enforces single use.
  const lookup = executed.find((call) => call.text.includes("from login_link_tokens join users"));
  assert.equal(lookup.values[0], hashLoginLinkToken("raw-token-value-1234"));
  const used = executed.find((call) => call.text.startsWith("update login_link_tokens set used_at"));
  assert.equal(used.values[0], "tok-1");
  assert.equal(executed.some((call) => call.text.startsWith("update users set last_login_at")), true);

  const event = telemetry.at(-1);
  assert.equal(event?.action, "auth.login");
  assert.equal(event?.outcome, "success");
  assert.equal(event?.resourceId, "user-1");
  assert.deepEqual(event?.metadata, { email: "ada@example.com", method: "login_link" });
});

test("login link confirm honours a validated next and blocks hostile ones", async () => {
  const valid = makeDeps(makeLoginLinkSql({ tokenRow: TOKEN_ROW }).sql);
  const validResponse = await handleLoginLinkConfirm(
    confirmLink("?token=raw-token-value-1234&next=%2Fconsole%3Fview%3Daccount"),
    valid.deps,
  );
  assert.equal(validResponse.headers.get("location"), "/console?view=account");

  for (const hostileNext of ["https%3A%2F%2Fevil.com", "%2F%2Fevil.com", "%2Flogin"]) {
    const hostile = makeDeps(makeLoginLinkSql({ tokenRow: TOKEN_ROW }).sql);
    const hostileResponse = await handleLoginLinkConfirm(
      confirmLink(`?token=raw-token-value-1234&next=${hostileNext}`),
      hostile.deps,
    );
    assert.equal(hostileResponse.headers.get("location"), "/console");
  }
});

test("invalid, expired, or used login links redirect to /login?error=login_link_invalid", async () => {
  // The lookup excludes used/expired rows, so all three collapse to "no row".
  const { sql } = makeLoginLinkSql({ tokenRow: null });
  const { deps, sessions, telemetry } = makeDeps(sql);

  const response = await handleLoginLinkConfirm(confirmLink("?token=raw-token-value-1234"), deps);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/login?error=login_link_invalid");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(sessions, []);
  assert.equal(telemetry.at(-1)?.outcome, "denied");
  assert.deepEqual(telemetry.at(-1)?.metadata, { method: "login_link", reason: "token_invalid" });

  const missing = makeDeps(makeLoginLinkSql().sql);
  const missingResponse = await handleLoginLinkConfirm(confirmLink(""), missing.deps);
  assert.equal(missingResponse.status, 302);
  assert.equal(missingResponse.headers.get("location"), "/login?error=login_link_invalid");
  assert.deepEqual(missing.rateLimitCalls, []);
});

test("login link confirm is single-use: losing the used_at race denies the login", async () => {
  const { sql } = makeLoginLinkSql({ tokenRow: TOKEN_ROW, loseUsedRace: true });
  const { deps, sessions } = makeDeps(sql);

  const response = await handleLoginLinkConfirm(confirmLink("?token=raw-token-value-1234"), deps);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/login?error=login_link_invalid");
  assert.deepEqual(sessions, []);
});

test("rate limited login link confirm redirects instead of minting a session", async () => {
  const { sql, executed } = makeLoginLinkSql({ tokenRow: TOKEN_ROW });
  const { deps, sessions } = makeDeps(sql, {
    checkRateLimit: async () => ({ allowed: false, attempts: 11, limit: 10, retryAfterSeconds: 600 }),
  });

  const response = await handleLoginLinkConfirm(confirmLink("?token=raw-token-value-1234"), deps);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/login?error=rate_limited");
  assert.deepEqual(executed, []);
  assert.deepEqual(sessions, []);
});

test("login link confirm never returns a raw 500 — failures redirect to /login", async () => {
  const { sql } = makeLoginLinkSql({ tokenRow: TOKEN_ROW, throwOn: "from login_link_tokens" });
  const { deps, sessions } = makeDeps(sql);

  const response = await handleLoginLinkConfirm(confirmLink("?token=raw-token-value-1234"), deps);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/login?error=login_link_invalid");
  assert.deepEqual(sessions, []);
});
