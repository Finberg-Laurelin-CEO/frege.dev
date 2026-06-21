import { getMembershipForOrg, type HumanOrgContext } from "@/lib/prototype/org-guard";
import { authenticateUserRequest } from "@/lib/prototype/session";

export type AdminAuthResult =
  | { ok: true; auth: HumanOrgContext }
  | { ok: false; response: Response };

export async function authenticateAdminRequest(req: Request, orgSlug?: string): Promise<AdminAuthResult> {
  const session = await authenticateUserRequest(req);
  if (!session) return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };

  const selectedOrgSlug = orgSlug ?? new URL(req.url).searchParams.get("org_slug") ?? session.memberships[0]?.org_slug;
  if (!selectedOrgSlug) return { ok: false, response: Response.json({ error: "missing_org" }, { status: 400 }) };

  const auth = getMembershipForOrg(session, selectedOrgSlug);
  if (!auth) return { ok: false, response: Response.json({ error: "forbidden_org" }, { status: 403 }) };
  if (!auth.capabilities.canManageOrg) {
    return { ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { ok: true, auth };
}
