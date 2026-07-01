import { authenticatePrototypeRequest, orgInactiveResponse, type PrototypeAuthContext } from "@/lib/prototype/auth";
import { getMembershipForOrg, type HumanOrgContext } from "@/lib/prototype/org-guard";
import { authenticateUserRequest } from "@/lib/prototype/session";
import type { SensitivityLabel } from "@/lib/prototype/types";

export type FregeActorContext =
  | {
      actorType: "api_key";
      apiKeyAuth: PrototypeAuthContext;
      organization: PrototypeAuthContext["organization"];
      allowedLabels: SensitivityLabel[];
      capabilities: PrototypeAuthContext["capabilities"] & {
        canManageOrg: false;
        canManageModels: false;
        canManageKeys: false;
      };
    }
  | {
      actorType: "user";
      userAuth: HumanOrgContext;
      organization: HumanOrgContext["organization"] & { status: string };
      allowedLabels: SensitivityLabel[];
      capabilities: {
        canCreateDocs: boolean;
        canUpdateDocs: boolean;
        canReadAudit: boolean;
        canManageOrg: boolean;
        canManageKeys: boolean;
        canManageModels: boolean;
        canReadSessions: boolean;
        canWriteSessions: boolean;
        canProposeMemory: boolean;
        canReviewMemoryProposals: boolean;
        canManageSources: boolean;
        canExecuteAgents: boolean;
      };
    };

export type ActorAuthResult =
  | { ok: true; actor: FregeActorContext }
  | { ok: false; response: Response };

function hasBearer(req: Request): boolean {
  return /^Bearer\s+/i.test(req.headers.get("authorization") ?? "");
}

// Pay-to-activate gate, generic over both actor shapes (API key and user/session).
// Returns a 403 response if the org is not active, otherwise null.
export function assertActiveActorOrg(actor: { organization: { status: string } }): Response | null {
  if (actor.organization.status !== "active") {
    return orgInactiveResponse(actor.organization.status);
  }
  return null;
}

export async function authenticateFregeActor(req: Request, orgSlug?: string): Promise<ActorAuthResult> {
  if (hasBearer(req)) {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
    if (orgSlug && auth.organization.slug !== orgSlug) {
      return { ok: false, response: Response.json({ error: "forbidden_org" }, { status: 403 }) };
    }
    // Pay-to-activate gate: agents (API keys) are blocked until the org is active.
    const inactive = assertActiveActorOrg(auth);
    if (inactive) return { ok: false, response: inactive };

    return {
      ok: true,
      actor: {
        actorType: "api_key",
        apiKeyAuth: auth,
        organization: auth.organization,
        allowedLabels: auth.allowedLabels,
        capabilities: {
          ...auth.capabilities,
          canManageOrg: false,
          canManageModels: false,
          canManageKeys: false,
        },
      },
    };
  }

  const session = await authenticateUserRequest(req);
  if (!session) return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };

  const selectedOrgSlug = orgSlug ?? session.memberships.find((membership) => membership.status === "active")?.org_slug;
  if (!selectedOrgSlug) return { ok: false, response: Response.json({ error: "missing_org" }, { status: 400 }) };

  const auth = getMembershipForOrg(session, selectedOrgSlug);
  if (!auth) return { ok: false, response: Response.json({ error: "forbidden_org" }, { status: 403 }) };

  const actor: FregeActorContext = {
    actorType: "user",
    userAuth: auth,
    organization: { ...auth.organization, status: auth.membership.org_status },
    allowedLabels: auth.allowedLabels,
    capabilities: {
      canCreateDocs: auth.capabilities.canManageOrg,
      canUpdateDocs: auth.capabilities.canManageOrg,
      canReadAudit: auth.capabilities.canReadAudit,
      canManageOrg: auth.capabilities.canManageOrg,
      canManageKeys: auth.capabilities.canManageKeys,
      canManageModels: auth.capabilities.canManageModels,
      canReadSessions: auth.capabilities.canReadSessions,
      canWriteSessions: auth.capabilities.canWriteSessions,
      canProposeMemory: auth.capabilities.canProposeMemory,
      canReviewMemoryProposals: auth.capabilities.canReviewMemoryProposals,
      canManageSources: auth.capabilities.canManageSources,
      canExecuteAgents: auth.capabilities.canExecuteAgents,
    },
  };

  // Pay-to-activate gate: users of an inactive/suspended org are blocked too.
  const inactive = assertActiveActorOrg(actor);
  if (inactive) return { ok: false, response: inactive };

  return { ok: true, actor };
}

export function telemetryActorForFregeActor(actor: FregeActorContext) {
  if (actor.actorType === "api_key") {
    return { type: "api_key" as const, auth: actor.apiKeyAuth };
  }
  return { type: "user" as const, auth: actor.userAuth };
}
