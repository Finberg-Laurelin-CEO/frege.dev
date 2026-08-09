#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
  throw new Error("Production build missing. Run pnpm build before smoke:mcp:middleware.");
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function request(port, authority, requestPath, authorization = true) {
  return new Promise((resolve, reject) => {
    const headers = {
      Host: authority,
      "X-Forwarded-Proto": "https",
    };
    if (authorization) headers.Authorization = "Bearer nonsecret-middleware-canary";
    const req = http.request(
      { hostname: "127.0.0.1", port, method: "POST", path: requestPath, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error("request timeout")));
    req.once("error", reject);
    req.end();
  });
}

async function waitUntilReady(port, child) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next exited before readiness (${child.exitCode})`);
    try {
      await request(port, "brain.frege.dev", "/mcp%2F");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError ?? new Error("Next readiness timeout");
}

function assertHardenedNotFound(result, label) {
  assert.equal(result.status, 404, `${label}: status`);
  assert.equal(result.headers.location, undefined, `${label}: must not redirect`);
  assert.match(result.headers["cache-control"] ?? "", /(?:^|,)\s*private(?:,|$)/, `${label}: private`);
  assert.match(result.headers["cache-control"] ?? "", /(?:^|,)\s*no-store(?:,|$)/, `${label}: no-store`);
  assert.deepEqual(JSON.parse(result.body), { error: "not_found" }, `${label}: body`);
}

const port = await freePort();
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
  cwd: root,
  env: {
    HOME: process.env.HOME ?? "",
    PATH: process.env.PATH ?? "",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    FREGE_STATELESS_MCP_ENABLED: "true",
    FREGE_MCP_ALLOWED_HOSTS: "localhost,127.0.0.1",
    IP_HASH_SALT: "nonsecret-middleware-canary-salt",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let diagnostics = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    diagnostics = `${diagnostics}${chunk.toString("utf8")}`.slice(-4000);
  });
}

try {
  await waitUntilReady(port, child);
  for (const authority of ["frege.dev", "www.frege.dev", "brain.frege.dev", "admin.frege.dev"]) {
    for (const requestPath of ["/mcp%2F", "/mcp%2f", "/MCP", "/%6dcp"]) {
      const result = await request(port, authority, requestPath);
      assertHardenedNotFound(result, `${authority}${requestPath}`);
    }
  }

  const brainExact = await request(port, "brain.frege.dev", "/mcp");
  assertHardenedNotFound(brainExact, "brain.frege.dev/mcp");
  const adminExact = await request(port, "admin.frege.dev", "/mcp");
  assertHardenedNotFound(adminExact, "admin.frege.dev/mcp");
  const wwwExact = await request(port, "www.frege.dev", "/mcp");
  assertHardenedNotFound(wwwExact, "www.frege.dev/mcp");

  const wwwMarketing = await request(port, "www.frege.dev", "/docs", false);
  assert.equal(wwwMarketing.status, 308);
  assert.equal(wwwMarketing.headers.location, "https://frege.dev/docs");

  const publicExact = await request(port, "frege.dev", "/mcp", false);
  assert.equal(publicExact.status, 401);
  assert.equal(publicExact.headers.location, undefined);
  assert.match(publicExact.headers["cache-control"] ?? "", /no-store/);

  console.log("Stateless MCP middleware smoke passed: encoded/case variants never redirect.");
} catch (error) {
  if (diagnostics) console.error(diagnostics);
  throw error;
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
