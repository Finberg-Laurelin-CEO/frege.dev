// Demo data powering the redesigned console's presentation sections
// (overview, activity, access). The documents, roles, links, and concepts
// continue to come from ./demo-data so the knowledge tab and these sections
// stay consistent; this module adds the richer activity traces, the hosted
// agents/models, and the helpers the new sections need. It is demo data only —
// the real hookups live in AdminConsole (keys) and BillingPanel (Stripe).

import type { SensitivityLabel } from "./types";

export type ConsoleAgent = {
  name: string;
  model: string;
  zone: string;
  lastRun: string;
  status: "ok" | "warn" | "down";
};

export const CONSOLE_AGENTS: ConsoleAgent[] = [
  { name: "support-copilot", model: "claude-sonnet", zone: "green zone", lastRun: "2m ago", status: "ok" },
  { name: "oncall-triage", model: "codex", zone: "green zone", lastRun: "11m ago", status: "ok" },
  { name: "sales-brief", model: "or-mixtral", zone: "green zone", lastRun: "38m ago", status: "ok" },
];

export type ConsoleModel = { name: string; provider: string; zone: string };

export const CONSOLE_MODELS: ConsoleModel[] = [
  { name: "claude-sonnet", provider: "anthropic", zone: "green" },
  { name: "codex", provider: "openai", zone: "green" },
  { name: "or-mixtral", provider: "openrouter", zone: "green" },
];

export type TraceDoc = { title: string; sensitivity: SensitivityLabel; detail: string };
export type TraceDenied = { label: string; sensitivity: SensitivityLabel; reason: string };
export type TraceModel = {
  name: string;
  inTokens: number;
  outTokens: number;
  latency: string;
  cost: string;
  zone: string;
};

export type ActivityStatus = "ok" | "denied" | "pending";
export type ActivityGroup = "runs" | "denied" | "writes";

export type ActivityEvent = {
  id: string;
  time: string;
  actor: string;
  action: string;
  status: ActivityStatus;
  group: ActivityGroup;
  summary: string;
  query: string;
  retrieved: TraceDoc[];
  denied: TraceDenied[];
  model: TraceModel | null;
  answer: string | null;
  note?: string | null;
};

// Every query -> context -> answer, with what was denied. Verbatim demo
// content mirroring the live audit ledger's shape.
export const CONSOLE_EVENTS: ActivityEvent[] = [
  {
    id: "e1",
    time: "14:32",
    actor: "support-copilot",
    action: "agent.run",
    status: "ok",
    group: "runs",
    summary: "Resolved a $180 double-charge refund question",
    query: "How should I handle a $180 refund for a double charge?",
    retrieved: [
      { title: "Customer Refund Policy", sensitivity: "internal", detail: "chunk 1–2 · included" },
      { title: "Sales Handoff Checklist", sensitivity: "internal", detail: "chunk 1 · included" },
    ],
    denied: [
      { label: "pricing-exceptions", sensitivity: "restricted", reason: "outside reader trust zone — title & body withheld" },
    ],
    model: { name: "claude-sonnet", inTokens: 1240, outTokens: 320, latency: "1.8s", cost: "$0.014", zone: "green" },
    answer:
      "Approve it. The charge is under $250 and a confirmed billing error qualifies for support approval without manager sign-off. Log it against the customer record.",
  },
  {
    id: "e2",
    time: "14:21",
    actor: "oncall-triage",
    action: "agent.run",
    status: "ok",
    group: "runs",
    summary: "Answered a DB latency alert with the on-call runbook",
    query: "DB latency alert on api-prod — what is the runbook?",
    retrieved: [{ title: "Engineering On-Call Runbook", sensitivity: "internal", detail: "chunk 1 · included" }],
    denied: [
      { label: "incident-escalation", sensitivity: "restricted", reason: "reader key cannot read restricted — escalation steps withheld" },
    ],
    model: { name: "codex", inTokens: 880, outTokens: 240, latency: "1.3s", cost: "$0.008", zone: "green" },
    answer:
      "Acknowledge the alert, identify the affected system, and check recent deploys before changing production state. Do not page externally from this runbook.",
  },
  {
    id: "e3",
    time: "14:08",
    actor: "frg_reader",
    action: "access.denied",
    status: "denied",
    group: "denied",
    summary: "Blocked: reader key tried to open a restricted policy",
    query: "open sales/pricing-exceptions.md",
    retrieved: [],
    denied: [{ label: "pricing-exceptions", sensitivity: "restricted", reason: "403 — reader trust zone excludes restricted documents" }],
    model: null,
    answer: null,
    note: "No content was returned. Frege logs the attempt without revealing the document’s title or body. Switch to an admin key to read restricted policies.",
  },
  {
    id: "e4",
    time: "13:55",
    actor: "sales-brief",
    action: "context.build",
    status: "ok",
    group: "runs",
    summary: "Built handoff context for a renewal brief",
    query: "renewal terms for the Q3 customer handoff",
    retrieved: [
      { title: "Sales Handoff Checklist", sensitivity: "internal", detail: "chunk 1 · included" },
      { title: "Customer Refund Policy", sensitivity: "internal", detail: "chunk 2 · included" },
    ],
    denied: [],
    model: null,
    answer: null,
    note: "Context packet assembled and returned to the agent. No model was invoked in this step — the agent reasoned locally over the packet.",
  },
  {
    id: "e5",
    time: "13:40",
    actor: "frg_writer",
    action: "proposal.created",
    status: "pending",
    group: "writes",
    summary: "Proposed a wording change to the refund policy",
    query: "Clarify the $250 threshold wording on customer-refunds",
    retrieved: [{ title: "Customer Refund Policy", sensitivity: "internal", detail: "base revision 3" }],
    denied: [],
    model: null,
    answer: null,
    note: "Reviewable write. The canonical document is unchanged until an admin accepts the proposal in Knowledge. Agents never silently rewrite the company brain.",
  },
  {
    id: "e6",
    time: "13:12",
    actor: "support-copilot",
    action: "agent.run",
    status: "ok",
    group: "runs",
    summary: "Answered a public question about the company",
    query: "Is the company in a SOC2 program?",
    retrieved: [{ title: "Company Overview", sensitivity: "public", detail: "chunk 1 · included" }],
    denied: [],
    model: { name: "claude-sonnet", inTokens: 410, outTokens: 90, latency: "0.9s", cost: "$0.003", zone: "green" },
    answer:
      "The public overview does not state a SOC2 status. Nothing internal was in scope for this reader key, so the agent declined to speculate.",
  },
  {
    id: "e7",
    time: "12:50",
    actor: "frg_admin",
    action: "audit.read",
    status: "ok",
    group: "denied",
    summary: "Admin reviewed the audit ledger",
    query: "list latest audit_events",
    retrieved: [],
    denied: [],
    model: null,
    answer: null,
    note: "Audit reads are themselves audited. Only roles with the audit capability can list the ledger — see Access.",
  },
  {
    id: "e8",
    time: "12:30",
    actor: "oncall-triage",
    action: "model.invoke",
    status: "ok",
    group: "runs",
    summary: "Large-context call flagged for review",
    query: "summarize all engineering runbooks",
    retrieved: [
      { title: "Engineering On-Call Runbook", sensitivity: "internal", detail: "chunk 1 · included" },
      { title: "Company Overview", sensitivity: "public", detail: "chunk 1 · included" },
    ],
    denied: [],
    model: { name: "codex", inTokens: 1980, outTokens: 360, latency: "2.4s", cost: "$0.019", zone: "green" },
    answer:
      "Returned a runbook summary. Flagged: the context query was broad (2 docs, 5 chunks) — narrow the query to reduce token cost.",
  },
  {
    id: "e9",
    time: "11:58",
    actor: "frg_reader",
    action: "documents.search",
    status: "ok",
    group: "denied",
    summary: "Searched ‘refund’ — 2 visible, 1 hidden",
    query: "refund",
    retrieved: [
      { title: "Customer Refund Policy", sensitivity: "internal", detail: "match · returned" },
      { title: "Sales Handoff Checklist", sensitivity: "internal", detail: "match · returned" },
    ],
    denied: [{ label: "1 restricted match", sensitivity: "restricted", reason: "hidden from results — reader trust zone" }],
    model: null,
    answer: null,
    note: "Search results are filtered by trust zone before they reach the agent. The hidden count is shown so operators know coverage is incomplete, without leaking titles.",
  },
];

// 24h hourly agent-call counts driving the overview sparkline.
export const CONSOLE_SPARK: number[] = [1, 0, 1, 0, 2, 1, 3, 2, 4, 6, 5, 7, 9, 8, 6, 7, 5, 8, 6, 4, 5, 7, 9, 8];

export type TrustZone = { name: string; tag: string; desc: string; sens: SensitivityLabel };

export const CONSOLE_TRUST_ZONES: TrustZone[] = [
  { name: "public", tag: "all agents", sens: "public", desc: "Readable by any approved key. Company-wide context with nothing confidential." },
  { name: "internal", tag: "role-gated", sens: "internal", desc: "Reader and writer keys see it; surfaced only to roles whose labels include internal." },
  {
    name: "restricted",
    tag: "admin trust zone",
    sens: "restricted",
    desc: "Only admin keys can discover or read. Titles, bodies, and semantic neighbors are withheld from everyone else.",
  },
];

// Capability columns for the access matrix, derived from a DemoRole.
export type RoleCaps = { audit: boolean; propose: boolean; review: boolean; run: boolean };

export function roleCaps(capabilities: {
  canCreateDocs: boolean;
  canUpdateDocs: boolean;
  canReadAudit: boolean;
}): RoleCaps {
  return {
    audit: capabilities.canReadAudit,
    propose: capabilities.canUpdateDocs,
    review: capabilities.canReadAudit,
    run: true,
  };
}
