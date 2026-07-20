export const ACTIVATION_TARGET_MINUTES = 15;

export const ACTIVATION_MILESTONE_DEFINITIONS = [
  {
    id: "account_created",
    title: "Account created",
    detail: "Your workspace, owner account, membership, and default roles are ready.",
    section: "account",
  },
  {
    id: "email_verified",
    title: "Email verified",
    detail: "Verification unlocks billing and other protected account actions.",
    section: "account",
  },
  {
    id: "billing_active",
    title: "Workspace active",
    detail: "Billing, a promotion, or staff activation has opened the server-side product gates.",
    section: "billing",
  },
  {
    id: "api_key_issued",
    title: "First API key issued",
    detail: "A scoped credential is ready for a CLI, MCP client, or direct API call.",
    section: "connect",
  },
  {
    id: "client_call_observed",
    title: "First CLI / MCP / API call observed",
    detail: "Frege has received a successful request authenticated with an API key.",
    section: "connect",
  },
  {
    id: "source_imported",
    title: "First source or document imported",
    detail: "The workspace has durable knowledge that an agent can retrieve.",
    section: "knowledge",
  },
  {
    id: "cited_context_built",
    title: "First cited context packet built",
    detail: "A permission-filtered context build returned at least one cited document or brain page.",
    section: "overview",
  },
  {
    id: "proposal_approved",
    title: "First proposal approved",
    detail: "A human reviewer accepted an agent memory or document revision proposal.",
    section: "knowledge",
  },
] as const;

export type ActivationMilestoneId = (typeof ACTIVATION_MILESTONE_DEFINITIONS)[number]["id"];
export type ActivationSection = (typeof ACTIVATION_MILESTONE_DEFINITIONS)[number]["section"];

export type ActivationEvidence = {
  account_created_at: Date | string | null;
  email_verified_at: Date | string | null;
  billing_active_at: Date | string | null;
  api_key_issued_at: Date | string | null;
  client_call_observed_at: Date | string | null;
  source_imported_at: Date | string | null;
  cited_context_built_at: Date | string | null;
  proposal_approved_at: Date | string | null;
};

export type ActivationMilestone = {
  id: ActivationMilestoneId;
  title: string;
  detail: string;
  section: ActivationSection;
  completed: boolean;
  completed_at: string | null;
  minutes_from_account: number | null;
  within_first_15_minutes: boolean | null;
};

export type ActivationView = {
  version: 1;
  state: "in_progress" | "continuing" | "complete";
  complete_count: number;
  completed_in_target_count: number;
  total_count: number;
  next_milestone_id: ActivationMilestoneId | null;
  activated_at: string | null;
  window: {
    target_minutes: number;
    started_at: string | null;
    ends_at: string | null;
    elapsed_minutes: number | null;
    remaining_minutes: number | null;
    open: boolean;
  };
  milestones: ActivationMilestone[];
};

const EVIDENCE_FIELD_BY_ID: Record<ActivationMilestoneId, keyof ActivationEvidence> = {
  account_created: "account_created_at",
  email_verified: "email_verified_at",
  billing_active: "billing_active_at",
  api_key_issued: "api_key_issued_at",
  client_call_observed: "client_call_observed_at",
  source_imported: "source_imported_at",
  cited_context_built: "cited_context_built_at",
  proposal_approved: "proposal_approved_at",
};

function timestamp(value: Date | string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: Date | string | null): string | null {
  const parsed = timestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function activationViewFromEvidence(
  evidence: ActivationEvidence,
  now: Date = new Date(),
): ActivationView {
  const accountStartedMs = timestamp(evidence.account_created_at);
  const targetEndsMs =
    accountStartedMs === null ? null : accountStartedMs + ACTIVATION_TARGET_MINUTES * 60_000;

  const milestones = ACTIVATION_MILESTONE_DEFINITIONS.map((definition): ActivationMilestone => {
    const completedAtValue = evidence[EVIDENCE_FIELD_BY_ID[definition.id]];
    const completedAtMs = timestamp(completedAtValue);
    const minutesFromAccount =
      completedAtMs === null || accountStartedMs === null
        ? null
        : oneDecimal(Math.max(0, completedAtMs - accountStartedMs) / 60_000);

    return {
      ...definition,
      completed: completedAtMs !== null,
      completed_at: iso(completedAtValue),
      minutes_from_account: minutesFromAccount,
      within_first_15_minutes:
        completedAtMs === null || targetEndsMs === null ? null : completedAtMs <= targetEndsMs,
    };
  });

  const completeCount = milestones.filter((milestone) => milestone.completed).length;
  const completedInTargetCount = milestones.filter(
    (milestone) => milestone.within_first_15_minutes === true,
  ).length;
  const allComplete = completeCount === milestones.length;
  const nowMs = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const windowOpen = targetEndsMs !== null && nowMs <= targetEndsMs;
  const completedTimes = milestones
    .map((milestone) => timestamp(milestone.completed_at))
    .filter((value): value is number => value !== null);

  return {
    version: 1,
    state: allComplete ? "complete" : windowOpen ? "in_progress" : "continuing",
    complete_count: completeCount,
    completed_in_target_count: completedInTargetCount,
    total_count: milestones.length,
    next_milestone_id: milestones.find((milestone) => !milestone.completed)?.id ?? null,
    activated_at: allComplete && completedTimes.length > 0
      ? new Date(Math.max(...completedTimes)).toISOString()
      : null,
    window: {
      target_minutes: ACTIVATION_TARGET_MINUTES,
      started_at: iso(evidence.account_created_at),
      ends_at: targetEndsMs === null ? null : new Date(targetEndsMs).toISOString(),
      elapsed_minutes:
        accountStartedMs === null ? null : oneDecimal(Math.max(0, nowMs - accountStartedMs) / 60_000),
      remaining_minutes:
        targetEndsMs === null ? null : oneDecimal(Math.max(0, targetEndsMs - nowMs) / 60_000),
      open: windowOpen && !allComplete,
    },
    milestones,
  };
}
