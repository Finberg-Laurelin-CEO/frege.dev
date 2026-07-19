import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();

function effectiveTrackedFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .filter((path) => existsSync(`${root}/${path}`));
}

const containedPublicPaths = [
  "ADMIN_PANEL_UX_PLAN.md",
  "ADMIN_SUBDOMAIN_SHELL_PLAN.md",
  "ORCHESTRATION_WORKSTREAMS.md",
  "PUBLIC_VALUE_PROP_PLAN.md",
  "STRIPE_REVENUE_VISIBILITY_PLAN.md",
  "USER_AUTH_API_KEYS_PLAN.md",
  "docs/ADMIN_ACCESS.md",
  "docs/AUTH0_AS_CODE.md",
  "docs/BACKEND_ARCHITECTURE_NOTE.md",
  "docs/CLAUDE_FRONTEND_HANDOFF.md",
  "docs/DEMO_OPERATOR_CHECKLIST.md",
  "docs/GBRAIN_TO_FREGE.md",
  "docs/HANDOFF.md",
  "docs/HERMES.md",
  "docs/HERMES_SETUP.md",
  "docs/HOSTED_BRAIN_ARCHITECTURE.md",
  "docs/INCIDENT_STRIPE_WEBHOOK_2026-07.md",
  "docs/INVESTOR_DEMO_WORKFLOW.md",
  "docs/LOCAL_WORKLOG.md",
  "docs/LOOM_INVESTOR_DEMO_SCRIPT.md",
  "docs/OAUTH_SETUP.md",
  "docs/PROTOTYPE_OPERATIONS.md",
  "docs/PROTOTYPE_SETUP.md",
  "docs/STRIPE_CHANGELOG.md",
  "docs/STRIPE_SETUP.md",
  "docs/SUPPORT_TICKETS_REQUIREMENTS.md",
];

test("private plans and operational records stay out of the effective public tree", () => {
  const tracked = new Set(effectiveTrackedFiles());

  for (const path of containedPublicPaths) {
    assert.equal(tracked.has(path), false, `${path} must remain privately contained`);
  }

  assert.equal(
    [...tracked].some((path) => path.startsWith("plans/")),
    false,
    "plans/ must not contain tracked files",
  );
});

test("the docs sync manifest is a public-safe allowlist", async () => {
  const manifest = await readFile(`${root}/frege.docs.yml`, "utf8");
  const tracked = new Set(effectiveTrackedFiles());
  const paths = [...manifest.matchAll(/^\s*- path:\s*(.+?)\s*$/gm)].map((match) => match[1]);

  assert.ok(paths.length > 0, "frege.docs.yml must include at least one document");
  assert.equal(new Set(paths).size, paths.length, "frege.docs.yml contains duplicate paths");
  assert.doesNotMatch(manifest, /investor|fundrais|worklog|incident|operator checklist|demo-data\//i);

  for (const path of paths) {
    assert.equal(tracked.has(path), true, `${path} must exist in the tracked public tree`);
  }
});

test("copyable public CLI examples use shell-safe token variables", async () => {
  const files = [
    "README.md",
    "docs/FREGE_MCP_INSTALL.md",
    "packages/frege-cli/README.md",
    "packages/frege-cli/INSTALL_FOR_AGENTS.md",
  ];

  for (const path of files) {
    const copy = await readFile(`${root}/${path}`, "utf8");
    assert.doesNotMatch(copy, /--token\s+<[^>]+>/, `${path} contains shell redirection as a token placeholder`);
    assert.doesNotMatch(copy, /--token\s+frg_live_\.\.\./, `${path} contains a non-runnable token placeholder`);
    assert.doesNotMatch(copy, /INVESTOR_DEMO_WORKFLOW|LOOM_INVESTOR|HANDOFF\.md/, `${path} links private material`);
  }
});
