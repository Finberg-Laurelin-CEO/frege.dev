import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = process.cwd();
const PROFILE_DIR = path.join(ROOT, "packages", "frege-agent-profile");

async function readProfileFile(relativePath) {
  return readFile(path.join(PROFILE_DIR, relativePath), "utf8");
}

test("the Hermes profile is a minimal local Frege agent distribution", async () => {
  const [manifest, config, soul, skill] = await Promise.all([
    readProfileFile("distribution.yaml"),
    readProfileFile("config.yaml"),
    readProfileFile("SOUL.md"),
    readProfileFile(path.join("skills", "use-frege-memory", "SKILL.md")),
  ]);

  assert.match(manifest, /^name: frege-agent$/m);
  assert.match(manifest, /^version: 0\.1\.0$/m);
  assert.match(manifest, /^hermes_requires: ">=0\.16\.0"$/m);

  assert.match(config, /disabled_toolsets:\s*\n\s*- memory/);
  assert.match(config, /command: "frege"/);
  assert.match(config, /args: \["mcp", "serve"\]/);
  assert.doesNotMatch(config, /^\s*(model|provider):/m);
  assert.doesNotMatch(config, /FREGE_API_KEY|FREGE_BASE_URL|frg_live_|sk-[A-Za-z0-9]/);

  for (const hostedSurface of [
    "frege_run_agent",
    "frege_list_agents",
    "frege_get_agent_run",
    "frege_invoke_model",
  ]) {
    assert.doesNotMatch(config, new RegExp(hostedSurface));
    assert.doesNotMatch(soul, new RegExp(hostedSurface));
    assert.doesNotMatch(skill, new RegExp(hostedSurface));
  }

  assert.match(soul, /Frege does not run your model or your agent process/);
  assert.match(
    skill,
    /The model, agent loop, filesystem, shell, and other tools remain in the user's\s+environment/,
  );
});

test("the profile allowlist contains only shipped MCP tools and excludes direct canonical creation", async () => {
  const [config, cliSource] = await Promise.all([
    readProfileFile("config.yaml"),
    readFile(path.join(ROOT, "packages", "frege-cli", "bin", "frege-mcp.mjs"), "utf8"),
  ]);

  const profileTools = [...config.matchAll(/^\s+- (frege_[a-z0-9_]+)$/gm)].map((match) => match[1]);
  const toolSection = cliSource.slice(0, cliSource.indexOf("function parseArgs"));
  const shippedTools = new Set([...toolSection.matchAll(/name: "(frege_[a-z0-9_]+)"/g)].map((match) => match[1]));

  assert.equal(profileTools.length, 22);
  assert.equal(new Set(profileTools).size, profileTools.length);
  for (const toolName of profileTools) {
    assert.equal(shippedTools.has(toolName), true, `${toolName} must be shipped by the Frege CLI`);
  }
  assert.equal(profileTools.includes("frege_create_document"), false);
});

test("the profile ships no cron, credentials, model state, or runtime data", async () => {
  const entries = await readdir(PROFILE_DIR, { withFileTypes: true });
  assert.equal(entries.some((entry) => entry.name === "cron"), false);

  const forbiddenEntries = new Set([
    ".env",
    "auth.json",
    "memories",
    "sessions",
    "state.db",
    "gateway.pid",
  ]);
  for (const entry of entries) {
    assert.equal(forbiddenEntries.has(entry.name), false, `${entry.name} must not ship in the profile`);
  }

  await assert.rejects(access(path.join(PROFILE_DIR, ".env")));
});

test("the CLI reports its package version and exposes the Hermes installer", async () => {
  const cliPath = path.join(ROOT, "packages", "frege-cli", "bin", "frege-mcp.mjs");
  const packageMetadata = JSON.parse(
    await readFile(path.join(ROOT, "packages", "frege-cli", "package.json"), "utf8"),
  );
  const version = spawnSync(process.execPath, [cliPath, "--version"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const help = spawnSync(process.execPath, [cliPath, "help"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), packageMetadata.version);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /frege agent install hermes/);
  assert.match(help.stdout, /local Frege Agent profile/);
});
