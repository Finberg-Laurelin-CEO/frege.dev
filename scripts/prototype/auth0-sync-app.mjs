#!/usr/bin/env node
// Sync the admin Auth0 application's allowed URLs from checked-in config, so the
// admin.frege.dev callback/logout/web-origin fix can't get lost on a future
// tenant or app change. This is the "as code" source of truth for those URLs.
//
// It uses the Auth0 Management API. The application identified by
// AUTH0_CLIENT_ID must be authorized for the Management API with the
// `read:clients` and `update:clients` scopes (one-time grant in the Auth0
// dashboard: Applications -> APIs -> Auth0 Management API -> Machine to Machine).
//
// Usage:
//   AUTH0_DOMAIN=icfg-xxxx.us.auth0.com \
//   AUTH0_CLIENT_ID=... \
//   AUTH0_CLIENT_SECRET=... \
//   node scripts/prototype/auth0-sync-app.mjs [--dry-run]
//
// Nothing here is a secret; the desired URLs live in config below. Credentials
// come only from the environment (e.g. pulled from Vercel), never the repo.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "auth0-app-config.json");

const dryRun = process.argv.includes("--dry-run");

const domain = process.env.AUTH0_DOMAIN;
const clientId = process.env.AUTH0_CLIENT_ID;
const clientSecret = process.env.AUTH0_CLIENT_SECRET;

if (!domain || !clientId || !clientSecret) {
  console.error(
    "Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, and AUTH0_CLIENT_SECRET. " +
      "Pull them from Vercel: `vercel env pull` on the frege-admin project, or export manually.",
  );
  process.exit(1);
}

function loadConfig() {
  let raw;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(`Missing config file: ${CONFIG_PATH}`);
  }
  const config = JSON.parse(raw);
  for (const key of ["callbacks", "allowed_logout_urls", "web_origins"]) {
    if (!Array.isArray(config[key])) {
      throw new Error(`Config key "${key}" must be an array in ${CONFIG_PATH}`);
    }
  }
  return config;
}

async function getToken() {
  const response = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: `https://${domain}/api/v2/`,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || /unauthorized/i.test(text)) {
      throw new Error(
        "Auth0 rejected the client_credentials grant. Authorize this application " +
          "for the Auth0 Management API with read:clients and update:clients:\n" +
          "  Auth0 dashboard -> Applications -> APIs -> Auth0 Management API -> " +
          "Machine to Machine Applications -> enable this app -> add scopes.\n" +
          `Raw response: ${text}`,
      );
    }
    throw new Error(`Token request failed (${response.status}): ${text}`);
  }
  return JSON.parse(text).access_token;
}

async function api(token, path, options = {}) {
  const response = await fetch(`https://${domain}/api/v2${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Management API returned 403 for ${path}. The application is authorized but ` +
          `missing a scope (need read:clients and update:clients).\n${text}`,
      );
    }
    throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

// Union the desired URLs into the existing set so we never drop localhost /
// preview URLs that were added for development.
function mergeUnique(existing, desired) {
  const set = new Set([...(existing ?? []), ...desired]);
  return [...set];
}

function sameSet(a, b) {
  const sa = new Set(a ?? []);
  const sb = new Set(b ?? []);
  if (sa.size !== sb.size) return false;
  for (const value of sa) if (!sb.has(value)) return false;
  return true;
}

async function main() {
  const config = loadConfig();
  console.log(`Auth0 sync -> ${domain} (client ${clientId.slice(0, 6)}...${clientId.slice(-4)})`);

  const token = await getToken();
  const client = await api(token, `/clients/${clientId}?fields=callbacks,allowed_logout_urls,web_origins,name`);
  console.log(`Application: ${client.name ?? "(unnamed)"}`);

  const next = {
    callbacks: mergeUnique(client.callbacks, config.callbacks),
    allowed_logout_urls: mergeUnique(client.allowed_logout_urls, config.allowed_logout_urls),
    web_origins: mergeUnique(client.web_origins, config.web_origins),
  };

  const unchanged =
    sameSet(client.callbacks, next.callbacks) &&
    sameSet(client.allowed_logout_urls, next.allowed_logout_urls) &&
    sameSet(client.web_origins, next.web_origins);

  if (unchanged) {
    console.log("Already in sync. No changes needed.");
    return;
  }

  console.log("Desired (merged) URLs:");
  console.log(JSON.stringify(next, null, 2));

  if (dryRun) {
    console.log("--dry-run: not applying changes.");
    return;
  }

  await api(token, `/clients/${clientId}`, { method: "PATCH", body: JSON.stringify(next) });
  console.log("Applied. Auth0 application URLs are now in sync with config.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
