#!/usr/bin/env node
// Production-safe admin API smoke test. Requires FREGE_TEST_EMAIL and FREGE_TEST_PASSWORD.
// Performs login plus read-only admin API checks. It does not create or mutate data.

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

function cookieFrom(headers) {
  const setCookie = headers.get("set-cookie");
  assert(setCookie, "login response did not set a session cookie");
  return setCookie
    .split(/,(?=\s*[^;,]+=)/)
    .map((cookie) => cookie.split(";")[0].trim())
    .join("; ");
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      "User-Agent": "frege-admin-smoke",
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
  return { response, json };
}

async function step(name, fn) {
  process.stdout.write(`- ${name}... `);
  const output = await fn();
  console.log("ok");
  return output;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args["base-url"] || process.env.FREGE_BASE_URL);
  const email = args.email || process.env.FREGE_TEST_EMAIL;
  const password = args.password || process.env.FREGE_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error("Set FREGE_TEST_EMAIL and FREGE_TEST_PASSWORD for the admin smoke test.");
  }

  console.log(`Frege admin smoke -> ${baseUrl}`);
  console.log(`Test user -> ${email}`);

  const cookie = await step("login creates a session", async () => {
    const { response, json } = await request(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert(json.user?.email === email.toLowerCase(), "login returned the wrong user");
    return cookieFrom(response.headers);
  });

  const session = await step("auth/me returns active memberships", async () => {
    const { json } = await request(baseUrl, "/api/v1/auth/me", { cookie });
    assert(json.user?.email === email.toLowerCase(), "auth/me returned the wrong user");
    assert(Array.isArray(json.memberships), "auth/me missing memberships");
    assert(json.memberships.some((membership) => membership.status === "active"), "no active memberships found");
    return json;
  });

  const orgSlug = session.memberships.find((membership) => membership.status === "active")?.org_slug;
  assert(orgSlug, "missing active org slug");
  const query = `org_slug=${encodeURIComponent(orgSlug)}`;

  await step("admin orgs list", async () => {
    const { json } = await request(baseUrl, "/api/v1/admin/orgs", { cookie });
    assert(Array.isArray(json.organizations), "orgs response missing organizations");
    assert(json.organizations.some((org) => org.org_slug === orgSlug), "selected org missing from org list");
  });

  await step("admin roles list", async () => {
    const { json } = await request(baseUrl, `/api/v1/admin/roles?${query}`, { cookie });
    assert(Array.isArray(json.roles), "roles response missing roles");
    assert(json.roles.length > 0, "expected at least one role");
  });

  await step("admin api keys list", async () => {
    const { json } = await request(baseUrl, `/api/v1/admin/api-keys?${query}`, { cookie });
    assert(Array.isArray(json.api_keys), "api keys response missing api_keys");
  });

  await step("admin signup lead queue", async () => {
    const { json } = await request(baseUrl, `/api/v1/admin/signups?${query}`, { cookie });
    assert(Array.isArray(json.signups), "signups response missing signups");
  });

  await step("admin brain snapshot", async () => {
    const { json } = await request(baseUrl, `/api/v1/admin/brain?${query}`, { cookie });
    assert(Array.isArray(json.sources), "brain response missing sources");
    assert(Array.isArray(json.pages), "brain response missing pages");
    assert(Array.isArray(json.sessions), "brain response missing sessions");
    assert(Array.isArray(json.proposals), "brain response missing proposals");
  });

  await step("admin telemetry list", async () => {
    const { json } = await request(baseUrl, `/api/v1/admin/telemetry?${query}&limit=5`, { cookie });
    assert(json.summary && typeof json.summary === "object", "telemetry response missing summary");
    assert(Array.isArray(json.events), "telemetry response missing events");
  });
}

main().catch((error) => {
  console.error(`admin smoke failed: ${error.message}`);
  process.exit(1);
});
