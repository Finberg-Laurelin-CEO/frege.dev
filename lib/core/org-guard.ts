import { getSql } from "@/lib/db";
import type { UserSessionContext, UserSessionMembership } from "@/lib/core/session";
import type { SensitivityLabel } from "@/lib/core/types";

export type HumanOrgContext = {
  user: UserSessionContext["user"];
  organization: {
    id: string;
    slug: string;
    name: string;
  };
  membership: UserSessionMembership;
  allowedLabels: SensitivityLabel[];
  capabilities: {
    canManageOrg: boolean;
    canManageMembers: boolean;
    canManageKeys: boolean;
    canManageModels: boolean;
    canReadAudit: boolean;
    canReadSessions: boolean;
    canWriteSessions: boolean;
    canProposeMemory: boolean;
    canReviewMemoryProposals: boolean;
    canManageSources: boolean;
    canExecuteAgents: boolean;
  };
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function slugifyOrg(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}

function labelsForRole(role: UserSessionMembership["role"]): SensitivityLabel[] {
  if (role === "owner" || role === "admin") return ["public", "internal", "restricted"];
  if (role === "member") return ["public", "internal"];
  return ["public"];
}

function capabilitiesForRole(role: UserSessionMembership["role"]): HumanOrgContext["capabilities"] {
  const canManage = role === "owner" || role === "admin";
  return {
    canManageOrg: canManage,
    canManageMembers: canManage,
    canManageKeys: canManage,
    canManageModels: canManage,
    canReadAudit: canManage,
    canReadSessions: canManage,
    canWriteSessions: canManage,
    canProposeMemory: canManage,
    canReviewMemoryProposals: canManage,
    canManageSources: canManage,
    canExecuteAgents: canManage,
  };
}

export function orgContextFromMembership(session: UserSessionContext, membership: UserSessionMembership): HumanOrgContext {
  return {
    user: session.user,
    organization: {
      id: membership.org_id,
      slug: membership.org_slug,
      name: membership.org_name,
    },
    membership,
    allowedLabels: labelsForRole(membership.role),
    capabilities: capabilitiesForRole(membership.role),
  };
}

export function getMembershipForOrg(session: UserSessionContext, orgSlug: string): HumanOrgContext | null {
  const membership = session.memberships.find((item) => item.org_slug === orgSlug && item.status === "active");
  return membership ? orgContextFromMembership(session, membership) : null;
}

export function requireManageOrg(context: HumanOrgContext): Response | null {
  if (context.capabilities.canManageOrg) return null;
  return Response.json({ error: "forbidden" }, { status: 403 });
}

export function orgActivationRequiredResponse(status: string): Response {
  return Response.json(
    {
      error: "org_inactive",
      message:
        status === "suspended"
          ? "This organization is suspended. Manage billing in Stripe or contact support."
          : "Billing must activate this organization before this action is available.",
      org_status: status,
    },
    { status: 403 },
  );
}

export function assertActiveHumanOrg(context: HumanOrgContext): Response | null {
  if (context.membership.org_status === "active") return null;
  return orgActivationRequiredResponse(context.membership.org_status);
}

export function emailVerificationRequiredResponse(): Response {
  return Response.json(
    {
      error: "email_unverified",
      message: "Verify your email before this action is available.",
    },
    { status: 403 },
  );
}

export function assertVerifiedHumanUser(context: HumanOrgContext): Response | null {
  if (context.user.email_verified_at) return null;
  return emailVerificationRequiredResponse();
}

const DEFAULT_AGENT_ROLES = [
    {
      slug: "reader",
      name: "Reader",
      labels: ["public", "internal"],
      create: false,
      update: false,
      audit: false,
      sessions: false,
      writeSessions: true,
      proposeMemory: false,
      reviewMemory: false,
      sources: false,
      executeAgents: false,
    },
    {
      slug: "writer",
      name: "Writer",
      labels: ["public", "internal"],
      create: true,
      update: true,
      audit: false,
      sessions: true,
      writeSessions: true,
      proposeMemory: true,
      reviewMemory: false,
      sources: false,
      executeAgents: true,
    },
    {
      slug: "admin",
      name: "Admin",
      labels: ["public", "internal", "restricted"],
      create: true,
      update: true,
      audit: true,
      sessions: true,
      writeSessions: true,
      proposeMemory: true,
      reviewMemory: true,
      sources: true,
      executeAgents: true,
    },
  ];

/**
 * Build (but do not execute) the default agent-role inserts for an org.
 *
 * The statements are lazy query promises, so they can either be awaited
 * one-by-one (ensureDefaultAgentRoles) or spread into a `sql.transaction([...])`
 * batch by callers that need the whole onboarding flow to be atomic.
 */
export function defaultAgentRoleStatements(sql: ReturnType<typeof getSql>, orgId: string) {
  return DEFAULT_AGENT_ROLES.map(
    (role) => sql`
      insert into roles (
        org_id, slug, name, can_read_labels,
        can_create_docs, can_update_docs, can_read_audit,
        can_read_sessions, can_write_sessions, can_propose_memory,
        can_review_memory_proposals, can_manage_sources, can_execute_agents
      ) values (
        ${orgId}, ${role.slug}, ${role.name}, ${role.labels},
        ${role.create}, ${role.update}, ${role.audit},
        ${role.sessions}, ${role.writeSessions}, ${role.proposeMemory},
        ${role.reviewMemory}, ${role.sources}, ${role.executeAgents}
      )
      on conflict (org_id, slug) do nothing
    `,
  );
}

export async function ensureDefaultAgentRoles(orgId: string): Promise<void> {
  const sql = getSql();
  for (const statement of defaultAgentRoleStatements(sql, orgId)) {
    await statement;
  }
}
