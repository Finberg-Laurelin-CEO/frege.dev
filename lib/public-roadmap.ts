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
  "Frege is shipping the governed organizational-memory layer first, then adding policy-controlled integrations and execution without weakening provenance or customer choice.";

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
        id: "mcp-cli-access",
        title: "MCP and CLI access",
        description:
          "Connect Codex, Claude Code, and other MCP clients through the Frege CLI and a scoped API key.",
        status: "available",
      },
      {
        id: "model-routing",
        title: "Model routing",
        description:
          "Send governed context to an organization-configured model provider and record invocation telemetry.",
        status: "beta",
      },
      {
        id: "hosted-agent-runs",
        title: "Hosted agent runs",
        description:
          "Queue and inspect hosted, single-step agent runs while the policy-controlled multi-step runtime is developed.",
        status: "beta",
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
        id: "agent-service-principals",
        title: "Agent and service principals",
        description:
          "Represent humans, agents, and services as explicit identities with scoped, delegable credentials in the V2 technical preview.",
        status: "beta",
      },
      {
        id: "versioned-policies",
        title: "Versioned authorization policies",
        description:
          "Evaluate principal, action, and resource together under default-deny policies that can be reviewed and versioned.",
        status: "beta",
      },
      {
        id: "authorization-receipts",
        title: "Authorization receipts",
        description:
          "Return an attributable record of why access was allowed or denied without revealing restricted source content.",
        status: "beta",
      },
      {
        id: "connector-framework",
        title: "Governed GitHub connector",
        description:
          "Privately beta-test repository-scoped Markdown sync with stable source identity, revisions, access mapping, deletion handling, receipts, and connector health. Google Drive remains planned.",
        status: "beta",
      },
      {
        id: "unified-provenance",
        title: "Unified provenance ledger",
        description:
          "Connect reads, denials, context builds, proposals, approvals, and model activity in one attributable event history.",
        status: "beta",
      },
    ],
  },
  {
    id: "later",
    eyebrow: "Controlled execution",
    title: "Later",
    description:
      "Broader workflow and runtime capabilities built on the same policy checks, review boundaries, and portable organizational record.",
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
        title: "Approval gates",
        description:
          "Pause consequential work, collect an authorized decision, and resume from recorded state.",
        status: "planned",
      },
      {
        id: "frege-agent",
        title: "First-party Frege Agent",
        description:
          "Run bounded, multi-step tool loops under the same capability, approval, step, and spend controls as every other agent.",
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
