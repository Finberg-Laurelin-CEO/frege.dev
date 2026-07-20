import { activationViewForOrg } from "@/lib/core/activation";
import { getMembershipForOrg } from "@/lib/core/org-guard";
import { routeError } from "@/lib/core/request-guards";
import { authenticateUserRequest, userUnauthorized } from "@/lib/core/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await authenticateUserRequest(req);
    if (!session) return userUnauthorized();

    const url = new URL(req.url);
    const orgSlug = url.searchParams.get("org_slug") ?? session.memberships[0]?.org_slug;
    if (!orgSlug) return Response.json({ error: "missing_org" }, { status: 400 });

    const auth = getMembershipForOrg(session, orgSlug);
    if (!auth) return Response.json({ error: "forbidden_org" }, { status: 403 });

    const activation = await activationViewForOrg(auth);
    return Response.json(
      {
        organization: {
          id: auth.organization.id,
          slug: auth.organization.slug,
          name: auth.organization.name,
          status: auth.membership.org_status,
        },
        activation,
      },
      { status: 200 },
    );
  } catch (err) {
    return routeError("activation view failed", err);
  }
}
