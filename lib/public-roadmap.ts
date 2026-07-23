export const CAPABILITY_STATUSES = ["available", "beta", "planned"] as const;

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const CAPABILITY_HORIZONS = [
  "available-now",
  "building-next",
  "later",
] as const;

export type CapabilityHorizon = (typeof CAPABILITY_HORIZONS)[number];

export type RoadmapCapability = Readonly<{
  id: string;
  title: string;
  description: string;
  status: CapabilityStatus;
}>;

export type CapabilityGroup = Readonly<{
  id: CapabilityHorizon;
  eyebrow: string;
  title: string;
  description: string;
  capabilities: readonly RoadmapCapability[];
}>;

export const PUBLIC_ROADMAP_SUMMARY =
  "Your agents keep their own models and execution environment. Frege is shipping the governed organizational-memory layer they share, then adding policy-controlled integrations without weakening provenance or customer choice.";

export const CAPABILITY_GROUPS = [
  {
    id: "available-now",
    eyebrow: "Use today",
    title: "Available now",
    description:
      "The governed memory and context foundation available to Frege customers today. Beta capabilities are usable, but their interfaces may still change.",
    capabilities: [
      {
        id: "organizational-memory",
        title: "Versioned organizational memory",
        description:
          "Store organizational knowledge as governed pages and sources with revision history instead of scattering it across agent-local files.",
        status: "available",
      },
      {
        id: "scoped-cited-context",
        title: "Scoped, cited context",
        description:
          "Build task-specific context from sources the caller is allowed to receive, with citations back to the returned material.",
        status: "available",
      },
      {
        id: "reviewable-memory",
        title: "Reviewable memory updates",
        description:
          "Let agents propose durable knowledge changes while keeping canonical memory under human review.",
        status: "available",
      },
      {
        id: "session-ledger",
        title: "Session and event ledger",
        description:
          "Keep durable task context, context builds, tool activity, and notes connected to the work that produced them.",
        status: "available",
      },
      {
        id: "live-run-rooms",
        title: "Shared live Codex sessions",
        description:
          "Authorized teammates can watch, redirect, stop, resolve exact approval requests, and hand off a live Codex run while execution stays on its originating machine.",
        status: "beta",
      },
      {
        id: "mcp-cli-access",
        title: "MCP and CLI access",
        description:
          "Connect Codex, Claude Code, and other MCP clients through the Frege CLI and a scoped API key.",
        status: "available",
      },
      {
        id: "customer-run-agents",
        title: "Customer-run agents",
        description:
          "Connect Codex, Claude Code, or an internal agent—or download the Frege Agent profile for Hermes—while model access, tools, and compute stay in the customer's environment.",
        status: "available",
      },
    ],
  },
  {
    id: "building-next",
    eyebrow: "Policy first",
    title: "Building next",
    description:
      "The identity, policy, and provenance controls Frege needs before agents can safely receive broader access and take more consequential actions.",
    capabilities: [
      {
        id: "service-principals",
        title: "Service principals",
        description:
          "Represent humans and services as explicit identities with scoped, delegable credentials in the V2 technical preview. Direct identities for customer-run agents remain planned.",
        status: "planned",
      },
      {
        id: "versioned-policies",
        title: "Versioned authorization policies",
        description:
          "Evaluate principal, action, and resource together under default-deny policies that can be reviewed and versioned.",
        status: "planned",
      },
      {
        id: "authorization-receipts",
        title: "Authorization receipts",
        description:
          "Return an attributable record of why access was allowed or denied without revealing restricted source content.",
        status: "planned",
      },
      {
        id: "connector-framework",
        title: "Governed connector pilots",
        description:
          "Pilot repository-scoped GitHub sync only after the identity, recovery, deletion, and provenance contract is ready. Google Drive follows later.",
        status: "planned",
      },
      {
        id: "unified-provenance",
        title: "Unified provenance ledger",
        description:
          "Connect reads, denials, context builds, sessions, tool activity, proposals, and approvals in one attributable event history.",
        status: "planned",
      },
    ],
  },
  {
    id: "later",
    eyebrow: "Deliberate expansion",
    title: "Later",
    description:
      "Broader workflow and optional execution capabilities built only after the memory product and its policy boundaries are proven.",
    capabilities: [
      {
        id: "durable-tasks",
        title: "Durable tasks and workflows",
        description:
          "Track assigned principals, steps, inputs, outputs, and idempotent state transitions without overloading agent sessions.",
        status: "planned",
      },
      {
        id: "approval-gates",
        title: "Durable workflow approval gates",
        description:
          "Extend the live Codex approval path into durable, multi-step workflows that pause, collect an authorized decision, and resume from recorded state.",
        status: "planned",
      },
      {
        id: "frege-agent",
        title: "Optional hosted execution",
        description:
          "Offer bounded execution only when customers need it, under the same capability, approval, step, and spend controls as every other agent.",
        status: "planned",
      },
      {
        id: "portable-record",
        title: "Portable organizational record",
        description:
          "Export and import organizational knowledge with source, revision, and provenance context so customer memory is not trapped in one runtime.",
        status: "planned",
      },
      {
        id: "v2-control-contracts",
        title: "Stable control-plane contracts",
        description:
          "Add versioned API contracts for principals, policies, receipts, connectors, tasks, and approvals while preserving current v1 clients.",
        status: "planned",
      },
    ],
  },
] as const satisfies readonly CapabilityGroup[];

export const CAPABILITY_STATUS_LABELS = {
  available: "Available",
  beta: "Beta",
  planned: "Planned",
} as const satisfies Readonly<Record<CapabilityStatus, string>>;
