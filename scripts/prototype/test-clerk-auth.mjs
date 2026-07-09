#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// clerk-auth.ts imports shared modules through the TypeScript "@/" path alias;
// register the same resolve hook as test-oauth.mjs mapping "@/<x>" -> <repoRoot>/<x>.
// Three modules are stubbed to keep the test hermetic:
// - "@clerk/backend": the real package would work (it only does network at call
//   time), but the stub guarantees no Clerk code or network is ever touched and
//   lets us assert what the default deps pass to it.
// - "@/lib/core/session": request-guards pulls it in for assertSafeBrowserMutation
//   (unused here) and it would load the DB driver.
// - "@/lib/db": guarantees no driver loads (the flow gets its store injected).
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VIRTUAL = {
  "@clerk/backend": `
    globalThis.__clerkBackendCalls = { verifyToken: [], createClerkClient: [] };
    export async function verifyToken(token, options) {
      globalThis.__clerkBackendCalls.verifyToken.push({ token, options });
      if (token === "expired-token") throw new Error("token expired");
      return { sub: "clerk-user-1" };
    }
    export function createClerkClient(options) {
      globalThis.__clerkBackendCalls.createClerkClient.push(options);
      return { users: { async getUser() { throw new Error("network disabled in tests"); } } };
    }
  `,
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
  clerkConfigured,
  clerkExternalProvider,
  fetchClerkUser,
  handleClerkBridgeRequest,
  verifyClerkSessionToken,
} = await import("../../lib/core/clerk-auth.ts");
const { sessionCookie } = await import("../../lib/core/session-cookie.ts");

const HOST = "brain.frege.dev";

function setClerkEnv() {
  process.env.CLERK_SECRET_KEY = "sk_test_secret";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_publishable";
}

function clearClerkEnv() {
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

function bridgeRequest(body, { host = HOST, origin = `https://${HOST}` } = {}) {
  return new Request(`https://${host}/api/v1/auth/clerk/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: host,
      ...(origin ? { Origin: origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Normalized ClerkUserProfile as the default getClerkUser dep would return it.
function makeClerkUser({
  id = "clerk-user-1",
  firstName = "Ada",
  lastName = "Lovelace",
  email = "Ada@Example.com",
  emailVerified = true,
  hasPrimaryEmail = true,
  externalAccounts = [{ provider: "oauth_google", providerUserId: "google-sub-1" }],
} = {}) {
  return {
    id,
    firstName,
    lastName,
    primaryEmailAddressId: hasPrimaryEmail ? "idn-primary" : null,
    emailAddresses: email
      ? [{ id: "idn-primary", emailAddress: email, verificationStatus: emailVerified ? "verified" : "unverified" }]
      : [],
    externalAccounts,
  };
}

function makeUserStore({ identityUser = null, emailUser = null } = {}) {
  const calls = { findIdentityUser: [], linkIdentity: [], markEmailVerified: [], createUser: [], touchLastLogin: [] };
  const store = {
    async findIdentityUser(provider, subject) {
      calls.findIdentityUser.push({ provider, subject });
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

function makeDeps({ clerkUser, userStore, overrides = {} } = {}) {
  const telemetry = [];
  const sessions = [];
  const verifications = [];
  const { store, calls } = userStore ?? makeUserStore();
  const deps = {
    userStore: store,
    verifyClerkToken: async (token) => {
      verifications.push(token);
      if (token === "expired-token") throw new Error("token expired");
      return { userId: "clerk-user-1" };
    },
    getClerkUser: async (userId) => {
      if (clerkUser instanceof Error) throw clerkUser;
      return clerkUser ?? makeClerkUser({ id: userId });
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
    rateLimitedResponse: (limit) =>
      Response.json(
        { error: "rate_limited", retry_after_seconds: limit.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      ),
    ...overrides,
  };
  return { deps, telemetry, sessions, verifications, calls };
}

function setCookies(response) {
  return response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get("set-cookie")];
}

const ACTIVE_USER = {
  id: "user-1",
  email: "ada@example.com",
  name: "Ada",
  status: "active",
  email_verified_at: new Date(),
};

test("clerkConfigured requires both the secret and publishable keys", () => {
  clearClerkEnv();
  assert.equal(clerkConfigured(), false);

  process.env.CLERK_SECRET_KEY = "sk_test_secret";
  assert.equal(clerkConfigured(), false);

  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_publishable";
  assert.equal(clerkConfigured(), true);

  process.env.CLERK_SECRET_KEY = "   ";
  assert.equal(clerkConfigured(), false);
  clearClerkEnv();
});

test("clerkExternalProvider normalizes Clerk provider names to the identity vocabulary", () => {
  assert.equal(clerkExternalProvider("oauth_google"), "google");
  assert.equal(clerkExternalProvider("oauth_github"), "github");
  assert.equal(clerkExternalProvider("google"), "google");
  assert.equal(clerkExternalProvider("github"), "github");
  assert.equal(clerkExternalProvider("oauth_microsoft"), null);
  assert.equal(clerkExternalProvider("saml_okta"), null);
  assert.equal(clerkExternalProvider(""), null);
  assert.equal(clerkExternalProvider(null), null);
});

test("bridge 404s as oauth_not_configured when Clerk env is unset", async () => {
  clearClerkEnv();
  const { deps, sessions, telemetry } = makeDeps();

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "oauth_not_configured" });
  assert.deepEqual(sessions, []);
  assert.deepEqual(telemetry, []);
});

test("bridge rejects cross-origin posts before touching Clerk", async () => {
  setClerkEnv();
  const { deps, verifications } = makeDeps();

  const response = await handleClerkBridgeRequest(
    bridgeRequest({ token: "tok-1" }, { origin: "https://evil.com" }),
    deps,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "forbidden_origin" });
  assert.deepEqual(verifications, []);
  clearClerkEnv();
});

test("bridge rejects malformed JSON and missing tokens", async () => {
  setClerkEnv();

  const malformed = makeDeps();
  const malformedResponse = await handleClerkBridgeRequest(bridgeRequest("{not json"), malformed.deps);
  assert.equal(malformedResponse.status, 400);
  assert.deepEqual(await malformedResponse.json(), { error: "invalid_json" });

  const missing = makeDeps();
  const missingResponse = await handleClerkBridgeRequest(bridgeRequest({}), missing.deps);
  assert.equal(missingResponse.status, 400);
  assert.deepEqual(await missingResponse.json(), { error: "validation" });
  assert.deepEqual(missing.sessions, []);
  clearClerkEnv();
});

test("bridge rate limiting returns the standard 429", async () => {
  setClerkEnv();
  const { deps, sessions, verifications } = makeDeps({
    overrides: {
      checkRateLimit: async () => ({ allowed: false, attempts: 21, limit: 20, retryAfterSeconds: 600 }),
    },
  });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "rate_limited", retry_after_seconds: 600 });
  assert.deepEqual(sessions, []);
  assert.deepEqual(verifications, []);
  clearClerkEnv();
});

test("bridge rejects a bad or expired Clerk token as oauth_failed", async () => {
  setClerkEnv();
  const { deps, sessions, telemetry } = makeDeps();

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "expired-token" }), deps);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "oauth_failed" });
  assert.deepEqual(sessions, []);
  assert.equal(telemetry.at(-1)?.outcome, "denied");
  assert.equal(telemetry.at(-1)?.metadata?.reason, "token_invalid");
  clearClerkEnv();
});

test("bridge rejects when the Clerk user lookup fails", async () => {
  setClerkEnv();
  const { deps, sessions, telemetry } = makeDeps({ clerkUser: new Error("clerk api down") });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "oauth_failed" });
  assert.deepEqual(sessions, []);
  assert.equal(telemetry.at(-1)?.metadata?.reason, "user_lookup_failed");
  clearClerkEnv();
});

test("bridge rejects a Clerk user with no usable primary email", async () => {
  setClerkEnv();

  const noPrimary = makeDeps({ clerkUser: makeClerkUser({ hasPrimaryEmail: false }) });
  const noPrimaryResponse = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), noPrimary.deps);
  assert.equal(noPrimaryResponse.status, 403);
  assert.deepEqual(await noPrimaryResponse.json(), { error: "oauth_email_missing" });
  assert.equal(noPrimary.telemetry.at(-1)?.metadata?.reason, "email_missing");

  const noEmail = makeDeps({ clerkUser: makeClerkUser({ email: null }) });
  const noEmailResponse = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), noEmail.deps);
  assert.equal(noEmailResponse.status, 403);
  assert.deepEqual(await noEmailResponse.json(), { error: "oauth_email_missing" });
  clearClerkEnv();
});

test("bridge rejects an unverified primary email", async () => {
  setClerkEnv();
  const { deps, sessions, telemetry, calls } = makeDeps({
    clerkUser: makeClerkUser({ emailVerified: false }),
  });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "oauth_email_unverified" });
  assert.deepEqual(sessions, []);
  assert.deepEqual(calls.createUser, []);
  assert.deepEqual(calls.linkIdentity, []);
  assert.equal(telemetry.at(-1)?.outcome, "denied");
  assert.equal(telemetry.at(-1)?.metadata?.reason, "email_unverified");
  assert.equal(telemetry.at(-1)?.metadata?.method, "clerk_google");
  clearClerkEnv();
});

test("bridge signs in an existing google identity and mints a frege_session", async () => {
  setClerkEnv();
  const userStore = makeUserStore({ identityUser: ACTIVE_USER });
  const { deps, sessions, telemetry, calls } = makeDeps({ userStore });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, next: "/console" });

  // The identity lookup uses the exact row shape the hand-rolled flow writes.
  assert.deepEqual(calls.findIdentityUser, [{ provider: "google", subject: "google-sub-1" }]);
  assert.deepEqual(calls.linkIdentity, []);
  assert.deepEqual(calls.touchLastLogin, ["user-1"]);
  assert.deepEqual(sessions, [{ userId: "user-1", host: HOST }]);

  const cookies = setCookies(response);
  assert.equal(cookies.some((cookie) => cookie.startsWith("frege_session=")), true);
  assert.match(cookies.find((cookie) => cookie.startsWith("frege_session=")) ?? "", /HttpOnly/);

  const event = telemetry.at(-1);
  assert.equal(event?.action, "auth.login");
  assert.equal(event?.outcome, "success");
  assert.equal(event?.resourceType, "user");
  assert.equal(event?.resourceId, "user-1");
  assert.equal(event?.metadata?.method, "clerk_google");
  assert.equal(event?.metadata?.flow, "identity");
  assert.equal(event?.metadata?.email, "ada@example.com");
  clearClerkEnv();
});

test("bridge links a google identity by verified email and marks the email verified", async () => {
  setClerkEnv();
  const emailUser = { ...ACTIVE_USER, id: "user-2", email_verified_at: null };
  const userStore = makeUserStore({ emailUser });
  const { deps, sessions, telemetry, calls } = makeDeps({ userStore });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.linkIdentity, [
    { userId: "user-2", provider: "google", subject: "google-sub-1", email: "ada@example.com" },
  ]);
  assert.deepEqual(calls.markEmailVerified, ["user-2"]);
  assert.deepEqual(calls.createUser, []);
  assert.deepEqual(sessions, [{ userId: "user-2", host: HOST }]);
  assert.equal(telemetry.at(-1)?.metadata?.flow, "linked");
  assert.equal(telemetry.at(-1)?.metadata?.method, "clerk_google");
  clearClerkEnv();
});

test("bridge linking skips the verified-at update when already verified", async () => {
  setClerkEnv();
  const userStore = makeUserStore({ emailUser: { ...ACTIVE_USER, id: "user-3" } });
  const { deps, calls } = makeDeps({ userStore });

  await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.deepEqual(calls.markEmailVerified, []);
  assert.equal(calls.linkIdentity.length, 1);
  clearClerkEnv();
});

test("bridge creates a minimal user with a google identity row", async () => {
  setClerkEnv();
  const userStore = makeUserStore();
  const { deps, sessions, telemetry, calls } = makeDeps({ userStore });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.createUser, [{ email: "ada@example.com", name: "Ada Lovelace" }]);
  assert.deepEqual(calls.linkIdentity, [
    { userId: "user-created", provider: "google", subject: "google-sub-1", email: "ada@example.com" },
  ]);
  assert.deepEqual(calls.markEmailVerified, []);
  assert.deepEqual(calls.touchLastLogin, []);
  assert.deepEqual(sessions, [{ userId: "user-created", host: HOST }]);
  assert.equal(telemetry.at(-1)?.metadata?.flow, "created");
  clearClerkEnv();
});

test("bridge maps oauth_github external accounts to github identity rows", async () => {
  setClerkEnv();
  const userStore = makeUserStore();
  const { deps, telemetry, calls } = makeDeps({
    userStore,
    clerkUser: makeClerkUser({
      externalAccounts: [{ provider: "oauth_github", providerUserId: "12345" }],
    }),
  });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.findIdentityUser, [{ provider: "github", subject: "12345" }]);
  assert.deepEqual(calls.linkIdentity, [
    { userId: "user-created", provider: "github", subject: "12345", email: "ada@example.com" },
  ]);
  assert.equal(telemetry.at(-1)?.metadata?.method, "clerk_github");
  clearClerkEnv();
});

test("bridge ignores non-google/github external accounts and picks the first usable one", async () => {
  setClerkEnv();
  const userStore = makeUserStore({ identityUser: ACTIVE_USER });
  const { deps, telemetry, calls } = makeDeps({
    userStore,
    clerkUser: makeClerkUser({
      externalAccounts: [
        { provider: "oauth_microsoft", providerUserId: "ms-1" },
        { provider: "oauth_google", providerUserId: "google-sub-9" },
      ],
    }),
  });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.findIdentityUser, [{ provider: "google", subject: "google-sub-9" }]);
  assert.equal(telemetry.at(-1)?.metadata?.method, "clerk_google");
  clearClerkEnv();
});

test("bridge clerk_email fallback links by verified email without inserting an identity row", async () => {
  setClerkEnv();
  const emailUser = { ...ACTIVE_USER, id: "user-5", email_verified_at: null };
  const userStore = makeUserStore({ emailUser });
  const { deps, sessions, telemetry, calls } = makeDeps({
    userStore,
    clerkUser: makeClerkUser({ externalAccounts: [] }),
  });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.findIdentityUser, []);
  assert.deepEqual(calls.linkIdentity, []);
  assert.deepEqual(calls.markEmailVerified, ["user-5"]);
  assert.deepEqual(sessions, [{ userId: "user-5", host: HOST }]);
  assert.equal(telemetry.at(-1)?.metadata?.method, "clerk_email");
  assert.equal(telemetry.at(-1)?.metadata?.flow, "linked");
  clearClerkEnv();
});

test("bridge clerk_email fallback creates a user without an identity row", async () => {
  setClerkEnv();
  const userStore = makeUserStore();
  const { deps, telemetry, calls } = makeDeps({
    userStore,
    clerkUser: makeClerkUser({ externalAccounts: [] }),
  });

  const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.createUser, [{ email: "ada@example.com", name: "Ada Lovelace" }]);
  assert.deepEqual(calls.linkIdentity, []);
  assert.equal(telemetry.at(-1)?.metadata?.method, "clerk_email");
  assert.equal(telemetry.at(-1)?.metadata?.flow, "created");
  clearClerkEnv();
});

test("bridge rejects disabled accounts on both lookup paths", async () => {
  setClerkEnv();
  const disabled = { ...ACTIVE_USER, id: "user-6", status: "disabled", email_verified_at: null };

  for (const storeInput of [{ identityUser: disabled }, { emailUser: disabled }]) {
    const userStore = makeUserStore(storeInput);
    const { deps, sessions, telemetry } = makeDeps({ userStore });
    const response = await handleClerkBridgeRequest(bridgeRequest({ token: "tok-1" }), deps);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "oauth_account_disabled" });
    assert.deepEqual(sessions, []);
    assert.equal(telemetry.at(-1)?.outcome, "denied");
    assert.equal(telemetry.at(-1)?.metadata?.reason, "account_disabled");
  }
  clearClerkEnv();
});

test("bridge validates next and blocks external URLs and login loops", async () => {
  setClerkEnv();

  const valid = makeDeps({ userStore: makeUserStore({ identityUser: ACTIVE_USER }) });
  const validResponse = await handleClerkBridgeRequest(
    bridgeRequest({ token: "tok-1", next: "/console?view=account" }),
    valid.deps,
  );
  assert.deepEqual(await validResponse.json(), { ok: true, next: "/console?view=account" });

  for (const hostileNext of ["https://evil.com/phish", "//evil.com", "/login"]) {
    const hostile = makeDeps({ userStore: makeUserStore({ identityUser: ACTIVE_USER }) });
    const hostileResponse = await handleClerkBridgeRequest(
      bridgeRequest({ token: "tok-1", next: hostileNext }),
      hostile.deps,
    );
    assert.deepEqual(await hostileResponse.json(), { ok: true, next: "/console" });
  }
  clearClerkEnv();
});

test("default deps pass the secret key to @clerk/backend and never hit the network", async () => {
  setClerkEnv();
  const calls = globalThis.__clerkBackendCalls;

  const verified = await verifyClerkSessionToken("session-jwt");
  assert.deepEqual(verified, { userId: "clerk-user-1" });
  assert.equal(calls.verifyToken.at(-1)?.token, "session-jwt");
  assert.equal(calls.verifyToken.at(-1)?.options?.secretKey, "sk_test_secret");

  await assert.rejects(() => verifyClerkSessionToken("expired-token"), /token expired/);

  await assert.rejects(() => fetchClerkUser("clerk-user-1"), /network disabled in tests/);
  assert.equal(calls.createClerkClient.at(-1)?.secretKey, "sk_test_secret");
  clearClerkEnv();
});
