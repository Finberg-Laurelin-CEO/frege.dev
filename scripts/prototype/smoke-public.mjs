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
    { path: "/", needles: ["Request pilot access", "Frege"] },
    { path: "/signup", needles: ["Full name", "Work email", "Org size", "request access"] },
    { path: "/docs", needles: ["Set up Frege", "Connect over MCP", "frege doctor"] },
    { path: "/privacy", needles: ["privacy policy", "org size"] },
    { path: "/login", needles: ["login", "frege internal control plane"] },
  ];

  console.log(`Frege public smoke -> ${baseUrl}`);
  for (const route of routes) {
    await step(route.path, async () => {
      const separator = route.path.includes("?") ? "&" : "?";
      const text = await fetchText(`${baseUrl}${route.path}${separator}${bust}`);
      for (const needle of route.needles) {
        assert(text.includes(needle), `${route.path} missing text: ${needle}`);
      }
    });
  }
}

main().catch((error) => {
  console.error(`public smoke failed: ${error.message}`);
  process.exit(1);
});
