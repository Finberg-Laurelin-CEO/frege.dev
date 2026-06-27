#!/usr/bin/env node
// Mutating smoke test for staff-issued free activation codes.
//
// Required:
//   FREGE_PLATFORM_STAFF_KEY  platform staff API key
//   FREGE_TEST_EMAIL          owner/admin email for the inactive target org
//   FREGE_TEST_PASSWORD       owner/admin password
//   FREGE_COMP_SMOKE_ORG_SLUG inactive org slug to activate

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? next : true;
    if (parsed[key] === next) index += 1;
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  return (value || "http://localhost:3000").replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function cookieFrom(headers) {
  const setCookie = headers.get("set-cookie");
  assert(setCookie, "login response did not set a session cookie");
  return setCookie
    .split(/,(?=\s*[^;,]+=)/)
    .map((cookie) => cookie.split(";")[0].trim())
    .join("; ");
}

async function request(baseUrl, route, options = {}) {
  const method = options.method ?? "GET";
  const mutates = ["POST", "PATCH", "PUT", "DELETE"].includes(method.toUpperCase());
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
      ...(mutates ? { Origin: baseUrl } : {}),
      "User-Agent": "frege-free-code-smoke",
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (options.expectedStatus && response.status !== options.expectedStatus) {
    throw new Error(`${route} returned ${response.status}, expected ${options.expectedStatus}: ${text}`);
  }
  if (!options.expectedStatus && !response.ok) {
    throw new Error(`${route} returned ${response.status}: ${text}`);
  }
  return { response, status: response.status, json };
}

async function step(name, fn) {
  process.stdout.write(`- ${name}... `);
  const output = await fn();
  console.log("ok");
  return output;
}

async function createFreeCode(baseUrl, staffKey, label) {
  const { json } = await request(baseUrl, "/api/v1/platform/free-codes", {
    method: "POST",
    bearer: staffKey,
    body: {
      label,
      plan: "team",
      billing_interval: "permanent",
      seats: 3,
    },
  });
  assert(json.free_code?.id, "created code missing id");
  assert(/^FRG-COMP-/.test(json.raw_code ?? ""), "created code missing raw one-time value");
  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args["base-url"] || process.env.FREGE_BASE_URL);
  const staffKey = args["staff-key"] || process.env.FREGE_PLATFORM_STAFF_KEY;
  const email = args.email || process.env.FREGE_TEST_EMAIL;
  const password = args.password || process.env.FREGE_TEST_PASSWORD;
  const orgSlug = args["org-slug"] || process.env.FREGE_COMP_SMOKE_ORG_SLUG;

  if (!staffKey || !email || !password || !orgSlug) {
    throw new Error(
      "Set FREGE_PLATFORM_STAFF_KEY, FREGE_TEST_EMAIL, FREGE_TEST_PASSWORD, and FREGE_COMP_SMOKE_ORG_SLUG.",
    );
  }

  console.log(`Frege free-code smoke -> ${baseUrl}`);
  console.log(`Target inactive org -> ${orgSlug}`);

  const cookie = await step("login creates owner/admin session", async () => {
    const { response, json } = await request(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert(json.user?.email === email.toLowerCase(), "login returned the wrong user");
    return cookieFrom(response.headers);
  });

  await step("auth/me confirms target org ownership", async () => {
    const { json } = await request(baseUrl, "/api/v1/auth/me", { cookie });
    assert(
      json.memberships?.some((membership) => membership.org_slug === orgSlug && ["owner", "admin"].includes(membership.role)),
      "login user is not owner/admin of target org",
    );
  });

  await step("target org starts inactive", async () => {
    const { json } = await request(baseUrl, `/api/v1/platform/orgs?q=${encodeURIComponent(orgSlug)}`, {
      bearer: staffKey,
    });
    const org = json.organizations?.find((candidate) => candidate.slug === orgSlug);
    assert(org, "target org not visible to staff");
    assertEqual(org.status, "inactive", "target org status");
  });

  await step("invalid code is rejected", async () => {
    const { json } = await request(baseUrl, "/api/v1/billing/free-code/redeem", {
      method: "POST",
      cookie,
      expectedStatus: 404,
      body: { org_slug: orgSlug, code: "FRG-COMP-NOTREAL-NOTREAL" },
    });
    assertEqual(json.error, "invalid_code", "invalid code error");
  });

  const revoked = await step("staff creates then revokes unused code", async () => {
    const created = await createFreeCode(baseUrl, staffKey, `smoke revoked ${new Date().toISOString()}`);
    const { json } = await request(baseUrl, `/api/v1/platform/free-codes/${created.free_code.id}/revoke`, {
      method: "PATCH",
      bearer: staffKey,
    });
    assertEqual(json.free_code?.status, "revoked", "revoked code status");
    return created.raw_code;
  });

  await step("revoked code is rejected", async () => {
    const { json } = await request(baseUrl, "/api/v1/billing/free-code/redeem", {
      method: "POST",
      cookie,
      expectedStatus: 409,
      body: { org_slug: orgSlug, code: revoked },
    });
    assertEqual(json.error, "code_revoked", "revoked code error");
  });

  const valid = await step("staff creates activation code", async () => {
    const created = await createFreeCode(baseUrl, staffKey, `smoke success ${new Date().toISOString()}`);
    return created.raw_code;
  });

  await step("valid code activates org", async () => {
    const { json } = await request(baseUrl, "/api/v1/billing/free-code/redeem", {
      method: "POST",
      cookie,
      body: { org_slug: orgSlug, code: valid },
    });
    assertEqual(json.activation?.org_status, "active", "activated org status");
    assertEqual(json.activation?.entitlement_kind, "comp", "entitlement kind");
  });

  await step("reused code is rejected", async () => {
    const { json } = await request(baseUrl, "/api/v1/billing/free-code/redeem", {
      method: "POST",
      cookie,
      expectedStatus: 409,
      body: { org_slug: orgSlug, code: valid },
    });
    assertEqual(json.error, "code_redeemed", "reused code error");
  });

  await step("platform sees redeemed org", async () => {
    const { json } = await request(baseUrl, `/api/v1/platform/orgs?q=${encodeURIComponent(orgSlug)}`, {
      bearer: staffKey,
    });
    const org = json.organizations?.find((candidate) => candidate.slug === orgSlug);
    assertEqual(org?.status, "active", "target org final status");
    assertEqual(org?.subscription_status, "comp", "target org subscription status");
  });
}

main().catch((error) => {
  console.error(`free-code smoke failed: ${error.message}`);
  process.exit(1);
});
