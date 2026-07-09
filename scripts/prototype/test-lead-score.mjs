#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// lead-alert.ts and signup-monitor.ts import shared modules through the
// TypeScript "@/" path alias, which plain `node --test` cannot resolve.
// Register the same resolve hook as test-auth-flow.mjs mapping
// "@/<x>" -> <repoRoot>/<x>. The email module (Resend SDK) and the DB driver
// are stubbed virtually so the test stays hermetic — the real senders/clients
// are injected per test instead. Project modules are imported dynamically
// AFTER the hooks are registered.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VIRTUAL = {
  "@/lib/core/email":
    "export const sendHotLeadAlertEmail = async () => { throw new Error('inject sendEmail in tests'); };",
  "@/lib/db": "export const getSql = () => { throw new Error('inject sql in tests'); };",
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

const { scoreLead, bandForScore, HOT_MIN, WARM_MIN } = await import("../../lib/core/lead-score.ts");
const { maybeSendHotLeadAlert } = await import("../../lib/core/lead-alert.ts");
const { recordSignupMonitorEvent } = await import("../../lib/core/signup-monitor.ts");

// Baseline: a corporate signup with nothing filled in scores 0 (cold) and
// trips no HERMES.md high-signal rule. High-signal tests flip one field each.
const BASE = {
  work_email: "casey@examplecorp.com",
  company_size: "1-10",
  expected_users: 0,
  current_agent_tools: [],
  monthly_ai_spend: "Not provided",
  willing_to_pay: "Not sure yet",
  decision_timeline: "Researching",
  main_pain_point: "Just curious about the product.",
};

const WARM_FIXTURE = {
  ...BASE,
  expected_users: 25, // +15
  current_agent_tools: ["Codex", "Claude Code"], // +10
  monthly_ai_spend: "Under $500", // +5
  decision_timeline: "30 days", // +15
};

const HOT_FIXTURE = {
  ...BASE,
  company_size: "1000+",
  expected_users: 120, // +25
  current_agent_tools: ["Codex", "Claude Code", "Internal agent"], // +15
  monthly_ai_spend: "$10,000+", // +25
  willing_to_pay: "$10,000+ / mo",
  decision_timeline: "Now", // +25
  main_pain_point: "Agents need safe access to internal context.", // +10
};

test("cold fixture: empty qualification + freemail scores 0 and lands cold", () => {
  const cold = scoreLead({ ...BASE, work_email: "sam@gmail.com" });
  assert.equal(cold.score, 0); // freemail -10 clamps at 0
  assert.equal(cold.band, "cold");
  assert.deepEqual(cold.highSignals, []);
});

test("warm fixture: plan weights sum to 45 and land warm without high signals", () => {
  const warm = scoreLead(WARM_FIXTURE);
  assert.equal(warm.score, 45);
  assert.equal(warm.band, "warm");
  assert.deepEqual(warm.highSignals, []);
  assert.ok(warm.score >= WARM_MIN && warm.score < HOT_MIN);
});

test("hot fixture: every strong field maxes the score at 100", () => {
  const hot = scoreLead(HOT_FIXTURE);
  assert.equal(hot.score, 100);
  assert.equal(hot.band, "hot");
  assert.equal(hot.highSignals.length, 5);
});

test("scoring is deterministic", () => {
  assert.deepEqual(scoreLead(HOT_FIXTURE), scoreLead(HOT_FIXTURE));
  assert.deepEqual(scoreLead(WARM_FIXTURE), scoreLead(WARM_FIXTURE));
});

test("each HERMES.md high-signal rule alone forces the hot band", () => {
  const singles = [
    { ...BASE, willing_to_pay: "$500-$2,000 / mo" },
    { ...BASE, willing_to_pay: "$2,000-$10,000 / mo" },
    { ...BASE, willing_to_pay: "$10,000+ / mo" },
    { ...BASE, expected_users: 50 },
    { ...BASE, company_size: "201-1000" },
    { ...BASE, company_size: "1000+" },
    { ...BASE, decision_timeline: "Now" },
    { ...BASE, current_agent_tools: ["Internal agent"] },
  ];
  for (const fields of singles) {
    const lead = scoreLead(fields);
    assert.equal(lead.band, "hot", `expected hot for ${JSON.stringify(fields)}`);
    assert.ok(lead.score >= HOT_MIN);
    assert.ok(lead.highSignals.length >= 1);
  }
});

test("near-miss values do not trip high-signal rules", () => {
  assert.equal(scoreLead({ ...BASE, willing_to_pay: "$100-$500 / mo" }).band, "cold");
  assert.equal(scoreLead({ ...BASE, expected_users: 49 }).band, "cold"); // +15 only
  assert.equal(scoreLead({ ...BASE, company_size: "51-200" }).band, "cold");
  assert.equal(scoreLead({ ...BASE, decision_timeline: "30 days" }).band, "cold"); // +15 only
  assert.equal(scoreLead({ ...BASE, current_agent_tools: ["Codex"] }).band, "cold"); // +5 only
});

test("plan weight table: timeline, spend, users, stack, pain point, freemail", () => {
  // Decision timeline: now +25 (lifted to hot), this quarter +15, this half +5.
  assert.equal(scoreLead({ ...BASE, decision_timeline: "30 days" }).score, 15);
  assert.equal(scoreLead({ ...BASE, decision_timeline: "90 days" }).score, 5);

  // Monthly spend buckets mapped onto live enum values.
  assert.equal(scoreLead({ ...BASE, monthly_ai_spend: "Under $500" }).score, 5);
  assert.equal(scoreLead({ ...BASE, monthly_ai_spend: "$500-$2,000" }).score, 15);
  assert.equal(scoreLead({ ...BASE, monthly_ai_spend: "$2,000-$10,000" }).score, 15);
  assert.equal(scoreLead({ ...BASE, monthly_ai_spend: "$10,000+" }).score, 25);
  assert.equal(scoreLead({ ...BASE, monthly_ai_spend: "Unknown" }).score, 0);

  // Expected users: 1-9 +5, 10-49 +15 (50+ is a high signal, tested above).
  assert.equal(scoreLead({ ...BASE, expected_users: 1 }).score, 5);
  assert.equal(scoreLead({ ...BASE, expected_users: 10 }).score, 15);

  // Agent stack count: 1/2/3+ → +5/+10/+15; "We are evaluating" is not a tool.
  assert.equal(scoreLead({ ...BASE, current_agent_tools: ["Codex"] }).score, 5);
  assert.equal(scoreLead({ ...BASE, current_agent_tools: ["Codex", "Cursor"] }).score, 10);
  assert.equal(scoreLead({ ...BASE, current_agent_tools: ["Codex", "Cursor", "ChatGPT", "Other MCP tools"] }).score, 15);
  assert.equal(scoreLead({ ...BASE, current_agent_tools: ["We are evaluating"] }).score, 0);

  // Pain point keyword +10 (single bonus regardless of match count).
  assert.equal(scoreLead({ ...BASE, main_pain_point: "We need to audit agent access." }).score, 10);

  // Freemail -10.
  assert.equal(scoreLead({ ...WARM_FIXTURE, work_email: "sam@gmail.com" }).score, 35);
});

test("bandForScore matches the plan's cut-offs", () => {
  assert.equal(bandForScore(0), "cold");
  assert.equal(bandForScore(39), "cold");
  assert.equal(bandForScore(40), "warm");
  assert.equal(bandForScore(69), "warm");
  assert.equal(bandForScore(70), "hot");
  assert.equal(bandForScore(100), "hot");
});

// ── Hot-lead alert gating ────────────────────────────────────────────────────

const SIGNUP_SUMMARY = {
  name: "Casey Ops",
  work_email: "casey@examplecorp.com",
  company: "Example Corp",
  role: "CTO",
  company_size: "201-1000",
  expected_users: 80,
  current_agent_tools: ["Internal agent"],
  monthly_ai_spend: "$2,000-$10,000",
  willing_to_pay: "$2,000-$10,000 / mo",
  decision_timeline: "Now",
  main_pain_point: "Agents need governed access to internal context.",
};

function makeEmailSpy(result = { sent: true, id: "email-1" }) {
  const calls = [];
  const sendEmail = async (input) => {
    calls.push(input);
    if (result instanceof Error) throw result;
    return result;
  };
  return { sendEmail, calls };
}

test("hot band + configured address sends exactly one alert email", async () => {
  const { sendEmail, calls } = makeEmailSpy();
  const lead = { score: 82, band: "hot", highSignals: ["decision_timeline Now"] };

  const result = await maybeSendHotLeadAlert(lead, SIGNUP_SUMMARY, {
    sendEmail,
    alertEmail: "joe@frege.dev",
  });

  assert.deepEqual(result, { sent: true, reason: undefined });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, "joe@frege.dev");
  assert.equal(calls[0].score, 82);
  assert.deepEqual(calls[0].highSignals, ["decision_timeline Now"]);
  assert.equal(calls[0].signup.work_email, SIGNUP_SUMMARY.work_email);
});

test("non-hot bands never notify", async () => {
  for (const band of ["cold", "warm"]) {
    const { sendEmail, calls } = makeEmailSpy();
    const result = await maybeSendHotLeadAlert(
      { score: 45, band, highSignals: [] },
      SIGNUP_SUMMARY,
      { sendEmail, alertEmail: "joe@frege.dev" },
    );
    assert.deepEqual(result, { sent: false, reason: "not_hot" });
    assert.equal(calls.length, 0);
  }
});

test("unset FREGE_LEAD_ALERT_EMAIL skips the alert", async () => {
  const { sendEmail, calls } = makeEmailSpy();
  const result = await maybeSendHotLeadAlert(
    { score: 90, band: "hot", highSignals: ["expected_users 80"] },
    SIGNUP_SUMMARY,
    { sendEmail, alertEmail: null },
  );
  assert.deepEqual(result, { sent: false, reason: "alert_email_unset" });
  assert.equal(calls.length, 0);
});

test("a throwing email sender is swallowed, never propagated", async () => {
  const { sendEmail } = makeEmailSpy(new Error("resend down"));
  const result = await maybeSendHotLeadAlert(
    { score: 90, band: "hot", highSignals: ["expected_users 80"] },
    SIGNUP_SUMMARY,
    { sendEmail, alertEmail: "joe@frege.dev" },
  );
  assert.deepEqual(result, { sent: false, reason: "resend down" });
});

// ── Monitor event persistence ────────────────────────────────────────────────

function queryText(strings) {
  return strings.join(" ").replace(/\s+/g, " ").trim();
}

test("monitor events insert event_type + jsonb payload", async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: queryText(strings), values });
    return [];
  };
  const payload = { event: "frege.signup.created", signup: { id: "s-1", band: "hot" } };

  const result = await recordSignupMonitorEvent("frege.signup.created", payload, { sql });

  assert.deepEqual(result, { recorded: true });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].text.includes("insert into signup_monitor_events (event_type, payload)"));
  assert.equal(calls[0].values[0], "frege.signup.created");
  assert.deepEqual(JSON.parse(calls[0].values[1]), payload);
});

test("monitor insert failures are swallowed, never propagated", async () => {
  const sql = async () => {
    throw new Error("relation does not exist");
  };
  const result = await recordSignupMonitorEvent("frege.signup.stats.snapshot", { stats: {} }, { sql });
  assert.deepEqual(result, { recorded: false, reason: "relation does not exist" });
});
