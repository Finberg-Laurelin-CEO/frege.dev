import { getSql } from "@/lib/db";
import { billingSchemaResponse } from "@/lib/core/billing-errors";
import { billingSummaryFromRow, toIsoString, type OrgBillingSummaryRow } from "@/lib/core/billing-view-core";
import { getMembershipForOrg } from "@/lib/core/org-guard";
import { authenticateUserRequest, userUnauthorized } from "@/lib/core/session";
import { routeError } from "@/lib/core/request-guards";

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

    const sql = getSql();
    const [billing] = (await sql`
      select
        plan,
        billing_interval,
        seats,
        subscription_status,
        current_period_end,
        updated_at,
        stripe_customer_id
      from org_billing
      where org_id = ${auth.organization.id}
      limit 1
    `) as OrgBillingSummaryRow[];

    return Response.json(
      {
        organization: {
          id: auth.organization.id,
          slug: auth.organization.slug,
          name: auth.organization.name,
          status: auth.membership.org_status,
        },
        membership: {
          role: auth.membership.role,
          status: auth.membership.status,
          can_manage_billing: auth.capabilities.canManageOrg,
        },
        user: {
          email: auth.user.email,
          email_verified_at: toIsoString(auth.user.email_verified_at),
        },
        billing: billingSummaryFromRow(billing),
      },
      { status: 200 },
    );
  } catch (err) {
    const schemaError = billingSchemaResponse("billing summary storage missing", err);
    if (schemaError) return schemaError;
    return routeError("billing summary failed", err);
  }
}
