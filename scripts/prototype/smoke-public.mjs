#!/usr/bin/env node
// Production-safe public route smoke test. Requires no secrets and performs no mutations.

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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "frege-public-smoke",
    },
  });
  const text = await response.text();
  assert(response.ok, `${url} returned ${response.status}`);
  assert(text.length > 500, `${url} returned a suspiciously small response`);
  assert(!text.includes("Application error"), `${url} rendered an application error`);
  assert(!text.includes("Internal Server Error"), `${url} rendered an internal error`);
  return text;
}

async function step(name, fn) {
  process.stdout.write(`- ${name}... `);
  await fn();
  console.log("ok");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args["base-url"] || process.env.FREGE_BASE_URL);
  const bust = `smoke=${Date.now()}`;

  const routes = [
    {
      path: "/",
      needles: ["Frege"],
      anyNeedles: [
        ["Start now"],
        ["Your agents share", "Many agents"],
      ],
    },
    { path: "/signup", needles: ["Full name", "Work email", "Password", "Org size", "verify your email", "open account"] },
    { path: "/docs", needles: ["Set up Frege", "register MCP", "frege doctor"] },
    { path: "/architecture", needles: ["Architecture", "control plane", "trust zone"] },
    { path: "/roadmap", needles: ["Available now", "Building next", "Later"] },
    { path: "/pricing", needles: ["$20", "$15", "Enterprise"] },
    { path: "/contact", needles: ["hello@frege.dev", "Contact"] },
    { path: "/privacy", needles: ["Privacy at Frege", "data we process"] },
    { path: "/terms", needles: ["Terms for using Frege", "customer content"] },
    { path: "/login", needles: ["login", "Frege customer workspace"] },
  ];

  console.log(`Frege public smoke -> ${baseUrl}`);
  for (const route of routes) {
    await step(route.path, async () => {
      const separator = route.path.includes("?") ? "&" : "?";
      const text = await fetchText(`${baseUrl}${route.path}${separator}${bust}`);
      for (const needle of route.needles) {
        assert(text.includes(needle), `${route.path} missing text: ${needle}`);
      }
      for (const alternatives of route.anyNeedles || []) {
        assert(
          alternatives.some((needle) => text.includes(needle)),
          `${route.path} missing one of: ${alternatives.join(", ")}`,
        );
      }
    });
  }

  // Protected APIs must reject anonymous callers cleanly (401), never 500.
  const guarded = ["/api/v1/platform/orgs", "/api/v1/platform/usage", "/api/v1/platform/users"];
  for (const path of guarded) {
    await step(`${path} (anon 401)`, async () => {
      const res = await fetch(`${baseUrl}${path}`, { headers: { "User-Agent": "frege-public-smoke" } });
      assert(res.status === 401, `${path} expected 401 for anon, got ${res.status}`);
    });
  }
}

main().catch((error) => {
  console.error(`public smoke failed: ${error.message}`);
  process.exit(1);
});
