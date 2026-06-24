#!/usr/bin/env node
// Production-safe admin API smoke test. Requires FREGE_TEST_EMAIL and FREGE_TEST_PASSWORD.
// Performs login plus read-only admin API checks by default. Pass
// --include-api-key-lifecycle to create a temporary key, use it, revoke it, and
// verify revoked-key rejection.

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

function redactKey(value) {
  if (!value) return "missing";
  return `${value.slice(0, 12)}...${value.slice(-4)}`;
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
      ...(options.cookie && mutates ? { Origin: baseUrl } : {}),
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
  return { response, status: response.status, json };
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
  const includeApiKeyLifecycle = Boolean(
    args["include-api-key-lifecycle"] || process.env.FREGE_SMOKE_API_KEY_LIFECYCLE === "true",
  );

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

  const adminMembership = session.memberships.find(
    (membership) => membership.status === "active" && ["owner", "admin"].includes(membership.role),
  );
  assert(adminMembership, "test user must be an active org owner/admin for admin smoke checks");
  const orgSlug = adminMembership.org_slug;
  const query = `org_slug=${encodeURIComponent(orgSlug)}`;

  await step("admin orgs list", async () => {
    const { json } = await request(baseUrl, "/api/v1/admin/orgs", { cookie });
    assert(Array.isArray(json.organizations), "orgs response missing organizations");
    assert(json.organizations.some((org) => org.org_slug === orgSlug), "selected org missing from org list");
  });

  const members = await step("admin members list", async () => {
    const { json } = await request(baseUrl, `/api/v1/admin/members?${query}`, { cookie });
    assert(Array.isArray(json.members), "members response missing members");
    assert(json.members.some((member) => member.email === email.toLowerCase()), "test user missing from members list");
    return json.members;
  });

  const roles = await step("admin roles list", async () => {
    const { json } = await request(baseUrl, `/api/v1/admin/roles?${query}`, { cookie });
    assert(Array.isArray(json.roles), "roles response missing roles");
    assert(json.roles.length > 0, "expected at least one role");
    return json.roles;
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

  if (!includeApiKeyLifecycle) {
    console.log("- api key lifecycle smoke... skipped (pass --include-api-key-lifecycle to mutate/revoke a temporary key)");
    return;
  }

  const role = roles.find((candidate) => candidate.slug === "reader") ?? roles[0];
  const owner = members.find((member) => member.email === email.toLowerCase()) ?? members[0];
  assert(role?.slug, "missing role for API key lifecycle");
  assert(owner?.id, "missing owner user for API key lifecycle");

  let createdKeyId = "";
  let rawKey = "";
  try {
    rawKey = await step("admin API key creation returns one raw frg_live key", async () => {
      const { json } = await request(baseUrl, "/api/v1/admin/api-keys", {
        cookie,
        method: "POST",
        body: {
          org_slug: orgSlug,
          role_slug: role.slug,
          owner_user_id: owner.id,
          name: `smoke ${new Date().toISOString()}`,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
      assert(json.api_key?.id, "created key missing id");
      assert(/^frg_live_[a-f0-9]{12}_.+/.test(json.raw_key ?? ""), "created key missing raw frg_live value");
      createdKeyId = json.api_key.id;
      console.log(`created ${redactKey(json.raw_key)}`);
      return json.raw_key;
    });

    await step("generated API key can call actor status", async () => {
      const { json } = await request(baseUrl, "/api/v1/brain/status", {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      assertEqual(json.status?.actor_type, "api_key", "actor type");
      assertEqual(json.status?.organization?.slug, orgSlug, "api key org slug");
      assertEqual(json.status?.key?.owner_user_email, owner.email, "api key owner email");
    });

    await step("generated API key can call context build", async () => {
      const { json } = await request(baseUrl, "/api/v1/context/build", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { query: "refund policy", limit: 1 },
      });
      assert(json.context?.id, "context build missing id");
    });
  } finally {
    if (createdKeyId) {
      await step("admin API key revoke", async () => {
        const { json } = await request(baseUrl, `/api/v1/admin/api-keys/${createdKeyId}?${query}`, {
          cookie,
          method: "PATCH",
        });
        assertEqual(json.api_key?.status, "revoked", "revoked key status");
      });
    }
  }

  if (rawKey) {
    await step("revoked API key no longer authenticates", async () => {
      const { status, json } = await request(baseUrl, "/api/v1/brain/status", {
        expectedStatus: 401,
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      assertEqual(status, 401, "revoked key status code");
      assertEqual(json.error, "unauthorized", "revoked key error");
    });
  }
}

main().catch((error) => {
  console.error(`admin smoke failed: ${error.message}`);
  process.exit(1);
});
