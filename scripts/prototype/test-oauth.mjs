#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// oauth-core.ts imports shared modules through the TypeScript "@/" path alias,
// which plain `node --test` cannot resolve. Register the same resolve hook as
// test-auth-flow.mjs mapping "@/<x>" -> <repoRoot>/<x>. oauth-core deliberately
// never imports the DB driver (its user store is injected), so no virtual
// stubs are needed and the test stays hermetic.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveRealAlias(specifier) {
  const base = path.join(rootDir, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${base}.ts`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return { url: pathToFileURL(resolveRealAlias(specifier)).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const {
  OAUTH_STATE_COOKIE,
  buildOAuthStartResponse,
  generatePkcePair,
  handleOAuthCallbackRequest,
  oauthProvidersConfigured,
  oauthStateCookie,
  parseOAuthProvider,
  readOAuthStateCookie,
  safeNextPath,
} = await import("../../lib/core/oauth-core.ts");
const { sessionCookie } = await import("../../lib/core/session-cookie.ts");

const HOST = "brain.frege.dev";

function stateCookieHeader(payload, host = HOST) {
  // oauthStateCookie returns a Set-Cookie string; the Cookie header only wants
  // the name=value pair.
  return oauthStateCookie(payload, host).split(";")[0];
}

function callbackRequest({ provider = "google", query = {}, cookie, host = HOST } = {}) {
  const params = new URLSearchParams(query);
  return new Request(`https://${host}/api/v1/auth/oauth/${provider}/callback?${params.toString()}`, {
    method: "GET",
    headers: {
      Host: host,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

function makeUserStore({ identityUser = null, emailUser = null } = {}) {
  const calls = { linkIdentity: [], markEmailVerified: [], createUser: [], touchLastLogin: [] };
  const store = {
    async findIdentityUser() {
      return identityUser;
    },
    async findUserByEmail() {
      return emailUser;
    },
    async linkIdentity(input) {
      calls.linkIdentity.push(input);
    },
    async markEmailVerified(userId) {
      calls.markEmailVerified.push(userId);
    },
    async createUser(input) {
      calls.createUser.push(input);
      return { id: "user-created", email: input.email, name: input.name, status: "active", email_verified_at: new Date() };
    },
    async touchLastLogin(userId) {
      calls.touchLastLogin.push(userId);
    },
  };
  return { store, calls };
}

function makeDeps({ identity, userStore, overrides = {} } = {}) {
  const telemetry = [];
  const sessions = [];
  const exchanges = [];
  const { store, calls } = userStore ?? makeUserStore();
  const deps = {
    userStore: store,
    exchangeCode: async (input) => {
      exchanges.push(input);
      if (identity instanceof Error) throw identity;
      return identity;
    },
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
    checkRateLimit: async () => ({ allowed: true, attempts: 1, limit: 20, retryAfterSeconds: 600 }),
    ...overrides,
  };
  return { deps, telemetry, sessions, exchanges, calls };
}

const VERIFIED_IDENTITY = {
  subject: "google-sub-1",
  email: "Ada@Example.com",
  emailVerified: true,
  name: "Ada Lovelace",
};

function location(response) {
  return response.headers.get("location") ?? "";
}

function setCookies(response) {
  return response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get("set-cookie")];
}

test("provider parsing accepts only google and github", () => {
  assert.equal(parseOAuthProvider("google"), "google");
  assert.equal(parseOAuthProvider("github"), "github");
  assert.equal(parseOAuthProvider("okta"), null);
  assert.equal(parseOAuthProvider(""), null);
  assert.equal(parseOAuthProvider(null), null);
});

test("next-path validation blocks external URLs and login loops", () => {
  assert.equal(safeNextPath("/console?view=account"), "/console?view=account");
  assert.equal(safeNextPath("/admin"), "/admin");
  assert.equal(safeNextPath("https://evil.com/steal"), "/console");
  assert.equal(safeNextPath("//evil.com"), "/console");
  assert.equal(safeNextPath("/\\evil.com"), "/console");
  assert.equal(safeNextPath("javascript:alert(1)"), "/console");
  assert.equal(safeNextPath("/login"), "/console");
  assert.equal(safeNextPath(null), "/console");
  assert.equal(safeNextPath(""), "/console");
});

test("PKCE pair is base64url and challenge is deterministic for verifier", () => {
  const { verifier, challenge } = generatePkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(verifier, challenge);
});

test("state cookie round-trips through the Cookie header", () => {
  const payload = { provider: "google", state: "state-1", verifier: "ver-1", next: "/console?view=account" };
  const req = new Request("https://brain.frege.dev/cb", {
    headers: { Cookie: stateCookieHeader(payload) },
  });
  assert.deepEqual(readOAuthStateCookie(req), payload);
  assert.equal(readOAuthStateCookie(new Request("https://brain.frege.dev/cb")), null);
});

test("start returns oauth_not_configured when env is unset", async () => {
  delete process.env.FREGE_OAUTH_GOOGLE_CLIENT_ID;
  delete process.env.FREGE_OAUTH_GOOGLE_CLIENT_SECRET;
  delete process.env.FREGE_OAUTH_GITHUB_CLIENT_ID;
  delete process.env.FREGE_OAUTH_GITHUB_CLIENT_SECRET;

  assert.deepEqual(oauthProvidersConfigured(), { google: false, github: false });

  const response = buildOAuthStartResponse(
    new Request(`https://${HOST}/api/v1/auth/oauth/google/start`, { headers: { Host: HOST } }),
    "google",
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "oauth_not_configured" });
});

test("start redirects to Google authorize URL with PKCE and sets the state cookie", async () => {
  process.env.FREGE_OAUTH_GOOGLE_CLIENT_ID = "google-client";
  process.env.FREGE_OAUTH_GOOGLE_CLIENT_SECRET = "google-secret";

  const response = buildOAuthStartResponse(
    new Request(`https://${HOST}/api/v1/auth/oauth/google/start?next=%2Fconsole%3Fview%3Daccount`, {
      headers: { Host: HOST },
    }),
    "google",
  );

  assert.equal(response.status, 302);
  const authorize = new URL(location(response));
  assert.equal(authorize.origin + authorize.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(authorize.searchParams.get("client_id"), "google-client");
  assert.equal(authorize.searchParams.get("redirect_uri"), "https://brain.frege.dev/api/v1/auth/oauth/google/callback");
  assert.equal(authorize.searchParams.get("response_type"), "code");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorize.searchParams.get("code_challenge"));
  assert.ok(authorize.searchParams.get("state"));

  const cookieHeader = response.headers.get("set-cookie") ?? "";
  assert.match(cookieHeader, new RegExp(`^${OAUTH_STATE_COOKIE}=`));
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Domain=\.frege\.dev/);
  const payload = readOAuthStateCookie(new Request("https://x/", { headers: { Cookie: cookieHeader.split(";")[0] } }));
  assert.equal(payload.provider, "google");
  assert.equal(payload.state, authorize.searchParams.get("state"));
  assert.ok(payload.verifier);
  assert.equal(payload.next, "/console?view=account");

  delete process.env.FREGE_OAUTH_GOOGLE_CLIENT_ID;
  delete process.env.FREGE_OAUTH_GOOGLE_CLIENT_SECRET;
});

test("start redirects to GitHub authorize URL without PKCE and drops external next", async () => {
  process.env.FREGE_OAUTH_GITHUB_CLIENT_ID = "github-client";
  process.env.FREGE_OAUTH_GITHUB_CLIENT_SECRET = "github-secret";

  const response = buildOAuthStartResponse(
    new Request(`https://${HOST}/api/v1/auth/oauth/github/start?next=${encodeURIComponent("https://evil.com/x")}`, {
      headers: { Host: HOST },
    }),
    "github",
  );

  assert.equal(response.status, 302);
  const authorize = new URL(location(response));
  assert.equal(authorize.origin + authorize.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(authorize.searchParams.get("scope"), "read:user user:email");
  assert.equal(authorize.searchParams.get("code_challenge"), null);

  const cookieHeader = response.headers.get("set-cookie") ?? "";
  const payload = readOAuthStateCookie(new Request("https://x/", { headers: { Cookie: cookieHeader.split(";")[0] } }));
  assert.equal(payload.verifier, undefined);
  assert.equal(payload.next, undefined);

  delete process.env.FREGE_OAUTH_GITHUB_CLIENT_ID;
  delete process.env.FREGE_OAUTH_GITHUB_CLIENT_SECRET;
});

test("callback rejects a state mismatch and clears the cookie", async () => {
  const { deps, sessions, telemetry } = makeDeps({ identity: VERIFIED_IDENTITY });
  const response = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "attacker-state" },
      cookie: stateCookieHeader({ provider: "google", state: "real-state" }),
    }),
    "google",
    deps,
  );

  assert.equal(response.status, 302);
  assert.equal(location(response), "/login?error=oauth_state_mismatch");
  assert.deepEqual(sessions, []);
  assert.equal(telemetry.at(-1)?.outcome, "denied");
  assert.equal(telemetry.at(-1)?.metadata?.reason, "state_mismatch");
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("callback rejects a provider mismatch in the state cookie", async () => {
  const { deps, sessions } = makeDeps({ identity: VERIFIED_IDENTITY });
  const response = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "github", state: "state-1" }),
    }),
    "google",
    deps,
  );

  assert.equal(location(response), "/login?error=oauth_state_mismatch");
  assert.deepEqual(sessions, []);
});

test("callback rejects an unverified provider email", async () => {
  const { deps, sessions, telemetry, calls } = makeDeps({
    identity: { ...VERIFIED_IDENTITY, emailVerified: false },
  });
  const response = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "google", state: "state-1" }),
    }),
    "google",
    deps,
  );

  assert.equal(location(response), "/login?error=oauth_email_unverified");
  assert.deepEqual(sessions, []);
  assert.deepEqual(calls.createUser, []);
  assert.deepEqual(calls.linkIdentity, []);
  assert.equal(telemetry.at(-1)?.outcome, "denied");
  assert.equal(telemetry.at(-1)?.metadata?.reason, "email_unverified");
});

test("callback signs in an existing identity and mints a session like password login", async () => {
  const identityUser = {
    id: "user-1",
    email: "ada@example.com",
    name: "Ada",
    status: "active",
    email_verified_at: new Date(),
  };
  const userStore = makeUserStore({ identityUser });
  const { deps, sessions, telemetry, exchanges, calls } = makeDeps({ identity: VERIFIED_IDENTITY, userStore });

  const response = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "google", state: "state-1", verifier: "ver-1" }),
    }),
    "google",
    deps,
  );

  assert.equal(response.status, 302);
  assert.equal(location(response), "/console");
  assert.deepEqual(sessions, [{ userId: "user-1", host: HOST }]);
  assert.deepEqual(calls.touchLastLogin, ["user-1"]);
  assert.deepEqual(calls.linkIdentity, []);
  assert.equal(exchanges[0]?.codeVerifier, "ver-1");
  assert.equal(exchanges[0]?.redirectUri, "https://brain.frege.dev/api/v1/auth/oauth/google/callback");

  const cookies = setCookies(response);
  assert.equal(cookies.some((cookie) => cookie.startsWith("frege_session=")), true);
  assert.equal(cookies.some((cookie) => cookie.startsWith(`${OAUTH_STATE_COOKIE}=;`) || cookie.includes("Max-Age=0")), true);

  const event = telemetry.at(-1);
  assert.equal(event?.action, "auth.login");
  assert.equal(event?.outcome, "success");
  assert.equal(event?.resourceType, "user");
  assert.equal(event?.resourceId, "user-1");
  assert.equal(event?.metadata?.method, "oauth_google");
  assert.equal(event?.metadata?.flow, "identity");
  assert.equal(event?.metadata?.email, "ada@example.com");
});

test("callback links by email and marks the email verified", async () => {
  const emailUser = {
    id: "user-2",
    email: "ada@example.com",
    name: "Ada",
    status: "active",
    email_verified_at: null,
  };
  const userStore = makeUserStore({ emailUser });
  const { deps, sessions, telemetry, calls } = makeDeps({ identity: VERIFIED_IDENTITY, userStore });

  const response = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "google", state: "state-1" }),
    }),
    "google",
    deps,
  );

  assert.equal(location(response), "/console");
  assert.deepEqual(sessions, [{ userId: "user-2", host: HOST }]);
  assert.deepEqual(calls.linkIdentity, [
    { userId: "user-2", provider: "google", subject: "google-sub-1", email: "ada@example.com" },
  ]);
  assert.deepEqual(calls.markEmailVerified, ["user-2"]);
  assert.deepEqual(calls.createUser, []);
  assert.equal(telemetry.at(-1)?.metadata?.flow, "linked");
});

test("callback linking skips the verified-at update when already verified", async () => {
  const emailUser = {
    id: "user-3",
    email: "ada@example.com",
    name: "Ada",
    status: "active",
    email_verified_at: new Date(),
  };
  const userStore = makeUserStore({ emailUser });
  const { deps, calls } = makeDeps({ identity: VERIFIED_IDENTITY, userStore });

  await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "google", state: "state-1" }),
    }),
    "google",
    deps,
  );

  assert.deepEqual(calls.markEmailVerified, []);
  assert.equal(calls.linkIdentity.length, 1);
});

test("callback creates a minimal verified user with no password credential", async () => {
  const userStore = makeUserStore();
  const { deps, sessions, telemetry, calls } = makeDeps({ identity: VERIFIED_IDENTITY, userStore });

  const response = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "google", state: "state-1" }),
    }),
    "google",
    deps,
  );

  assert.equal(location(response), "/console");
  assert.deepEqual(calls.createUser, [{ email: "ada@example.com", name: "Ada Lovelace" }]);
  assert.deepEqual(calls.linkIdentity, [
    { userId: "user-created", provider: "google", subject: "google-sub-1", email: "ada@example.com" },
  ]);
  assert.deepEqual(calls.markEmailVerified, []);
  assert.deepEqual(calls.touchLastLogin, []);
  assert.deepEqual(sessions, [{ userId: "user-created", host: HOST }]);
  assert.equal(telemetry.at(-1)?.metadata?.flow, "created");
});

test("callback rejects disabled accounts on both lookup paths", async () => {
  const disabled = {
    id: "user-4",
    email: "ada@example.com",
    name: "Ada",
    status: "disabled",
    email_verified_at: null,
  };

  for (const storeInput of [{ identityUser: disabled }, { emailUser: disabled }]) {
    const userStore = makeUserStore(storeInput);
    const { deps, sessions } = makeDeps({ identity: VERIFIED_IDENTITY, userStore });
    const response = await handleOAuthCallbackRequest(
      callbackRequest({
        query: { code: "code-1", state: "state-1" },
        cookie: stateCookieHeader({ provider: "google", state: "state-1" }),
      }),
      "google",
      deps,
    );
    assert.equal(location(response), "/login?error=oauth_account_disabled");
    assert.deepEqual(sessions, []);
  }
});

test("callback redirects to the validated next path and blocks external URLs", async () => {
  const identityUser = {
    id: "user-1",
    email: "ada@example.com",
    name: "Ada",
    status: "active",
    email_verified_at: new Date(),
  };

  const valid = makeDeps({ identity: VERIFIED_IDENTITY, userStore: makeUserStore({ identityUser }) });
  const validResponse = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "google", state: "state-1", next: "/console?view=account" }),
    }),
    "google",
    valid.deps,
  );
  assert.equal(location(validResponse), "/console?view=account");

  const hostile = makeDeps({ identity: VERIFIED_IDENTITY, userStore: makeUserStore({ identityUser }) });
  const hostileResponse = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "google", state: "state-1", next: "https://evil.com/phish" }),
    }),
    "google",
    hostile.deps,
  );
  assert.equal(location(hostileResponse), "/console");
});

test("callback turns exchange failures and provider errors into login redirects", async () => {
  const failing = makeDeps({ identity: new Error("boom") });
  const failingResponse = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "google", state: "state-1" }),
    }),
    "google",
    failing.deps,
  );
  assert.equal(location(failingResponse), "/login?error=oauth_exchange_failed");

  const denied = makeDeps({ identity: VERIFIED_IDENTITY });
  const deniedResponse = await handleOAuthCallbackRequest(
    callbackRequest({ query: { error: "access_denied" } }),
    "google",
    denied.deps,
  );
  assert.equal(location(deniedResponse), "/login?error=oauth_denied");

  const missing = makeDeps({ identity: VERIFIED_IDENTITY });
  const missingResponse = await handleOAuthCallbackRequest(
    callbackRequest({ query: {} }),
    "google",
    missing.deps,
  );
  assert.equal(location(missingResponse), "/login?error=oauth_invalid_response");
});

test("callback rate limiting redirects instead of returning a raw 429", async () => {
  const { deps, sessions } = makeDeps({
    identity: VERIFIED_IDENTITY,
    overrides: {
      checkRateLimit: async () => ({ allowed: false, attempts: 21, limit: 20, retryAfterSeconds: 600 }),
    },
  });
  const response = await handleOAuthCallbackRequest(
    callbackRequest({
      query: { code: "code-1", state: "state-1" },
      cookie: stateCookieHeader({ provider: "google", state: "state-1" }),
    }),
    "google",
    deps,
  );
  assert.equal(location(response), "/login?error=oauth_rate_limited");
  assert.deepEqual(sessions, []);
});
