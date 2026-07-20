export type PublicProofStep = {
  id: string;
  elapsed: string;
  surface: "agent" | "frege" | "human";
  title: string;
  command: string;
  result: string;
  evidence: readonly string[];
  tone: "neutral" | "allowed" | "withheld" | "proposal" | "accepted";
};

export const PUBLIC_PROOF = {
  id: "engineering-release-context",
  audience: "AI engineering teams",
  duration: "90 seconds",
  title: "A coding agent asks what can ship. Frege shows the answer and the boundary.",
  summary:
    "This sanitized, deterministic walkthrough uses Frege's current CLI, MCP, and API surfaces. Names and contents are fictional; the identity, scoped-context, citation, denial, proposal, review, and audit behaviors are product capabilities rather than a recording of one customer session.",
  actor: {
    label: "release-agent",
    credential: "scoped API key",
    role: "writer",
    trustZone: "green",
  },
  steps: [
    {
      id: "resolve-caller",
      elapsed: "00:00",
      surface: "frege",
      title: "Resolve the caller before retrieval",
      command: "frege doctor",
      result: "The configured key resolves to an active organization and writer role.",
      evidence: ["API key: set", "organization: active", "role: writer"],
      tone: "neutral",
    },
    {
      id: "build-context",
      elapsed: "00:14",
      surface: "agent",
      title: "Build cited release context",
      command: 'frege context "Atlas checkout release readiness"',
      result: "Three current sources returned as one bounded context packet.",
      evidence: [
        "release-checklist.md@v4",
        "checkout-rollback.md@v2",
        "customer-impact.md@v6",
      ],
      tone: "allowed",
    },
    {
      id: "withhold-restricted",
      elapsed: "00:31",
      surface: "frege",
      title: "Withhold restricted matches",
      command: 'frege context "production credentials and incident access"',
      result:
        "Two restricted matches omitted. The packet reports the denial count without returning titles, snippets, or content.",
      evidence: ["decision: denied", "withheld: 2", "restricted content: not returned"],
      tone: "withheld",
    },
    {
      id: "propose-update",
      elapsed: "00:47",
      surface: "agent",
      title: "Propose a durable update",
      command: "frege_propose_memory_from_session(…)",
      result: "A pending memory proposal is created; canonical knowledge is unchanged.",
      evidence: ["status: pending", "write: proposed", "canonical revision: unchanged"],
      tone: "proposal",
    },
    {
      id: "human-review",
      elapsed: "01:04",
      surface: "human",
      title: "Review in the control plane",
      command: "engineering lead → inspect evidence → accept",
      result: "The reviewer accepts the proposal and Frege creates the next revision.",
      evidence: ["reviewer: engineering-lead", "decision: accepted", "revision: v7"],
      tone: "accepted",
    },
    {
      id: "audit-receipt",
      elapsed: "01:19",
      surface: "frege",
      title: "Leave one attributable history",
      command: "frege_audit_events({ limit: 25 })",
      result: "Allowed reads, denied matches, proposal, and review remain linked to the work.",
      evidence: ["context build", "denial", "proposal", "review", "revision"],
      tone: "neutral",
    },
  ] satisfies readonly PublicProofStep[],
} as const;

export const PUBLIC_PROOF_FORBIDDEN_PATTERNS = [
  /frg_(?:live|admin)_[a-z0-9_-]+/i,
  /bearer\s+[a-z0-9._~+/-]+/i,
  /@[a-z0-9.-]+\.(?:com|dev|ai)\b/i,
  /(?:customer|organization|project)[_-]?id\s*[:=]\s*[a-z0-9_-]+/i,
  /(?:api|client|webhook|signing)[_-]?(?:key|secret)\s*[:=]/i,
] as const;

export function serializePublicProof(): string {
  return JSON.stringify(PUBLIC_PROOF);
}
