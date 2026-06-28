import { getSql } from "@/lib/db";
import { getMembershipForOrg } from "@/lib/prototype/org-guard";
import { authenticateUserRequest, userUnauthorized } from "@/lib/prototype/session";
import { routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BillingSummaryRow = {
  plan: string | null;
  billing_interval: string | null;
  seats: number | null;
  subscription_status: string | null;
  current_period_end: Date | string | null;
  entitlement_kind: string | null;
  entitlement_status: string | null;
  comp_activated_at: Date | string | null;
  updated_at: Date | string | null;
};

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

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
        entitlement_kind,
        entitlement_status,
        comp_activated_at,
        updated_at
      from org_billing
      where org_id = ${auth.organization.id}
      limit 1
    `) as BillingSummaryRow[];

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
        billing: billing
          ? {
              plan: billing.plan,
              billing_interval: billing.billing_interval,
              seats: billing.seats,
              subscription_status: billing.subscription_status,
              current_period_end: toIsoString(billing.current_period_end),
              entitlement_kind: billing.entitlement_kind,
              entitlement_status: billing.entitlement_status,
              comp_activated_at: toIsoString(billing.comp_activated_at),
              updated_at: toIsoString(billing.updated_at),
            }
          : null,
      },
      { status: 200 },
    );
  } catch (err) {
    return routeError("billing summary failed", err);
  }
}
