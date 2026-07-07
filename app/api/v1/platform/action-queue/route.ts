import { getSql } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/prototype/billing";
import { authenticatePlatformStaff } from "@/lib/prototype/platform-auth";
import { routeError } from "@/lib/prototype/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActionItem = {
  kind: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  target_type: string | null;
  target_id: string | null;
};

export async function GET(req: Request) {
  try {
    const staff = await authenticatePlatformStaff(req);
    if (!staff.ok) return staff.response;

    const sql = getSql();
    const items: ActionItem[] = [];

    // Signups awaiting action: not disqualified and not yet invited.
    const pendingSignups = await sql`
      select id, work_email, created_at
      from signups
      where status <> 'disqualified'
        and invite_id is null
        and owner_user_id is null
      order by created_at asc
      limit 50
    `;
    for (const s of pendingSignups as Array<{ id: string; work_email: string }>) {
      items.push({
        kind: "signup_pending",
        severity: "medium",
        title: "Signup awaiting approval",
        detail: s.work_email,
        target_type: "signup",
        target_id: s.id,
      });
    }

    // Approved/invited signups whose linked org has not become active after 3 days.
    const approvedUnpaid = await sql`
      select
        s.id,
        s.work_email,
        s.invited_at,
        o.id as org_id,
        o.slug as org_slug,
        o.name as org_name,
        b.subscription_status
      from signups s
      join organization_invites i on i.id = s.invite_id
      join organizations o on o.id = i.org_id
      left join org_billing b on b.org_id = o.id
      where s.invite_id is not null
        and s.invited_at <= now() - interval '3 days'
        and s.paid_at is null
        and o.status = 'inactive'
      order by s.invited_at asc
      limit 50
    `;
    for (const s of approvedUnpaid as Array<{
      id: string;
      work_email: string;
      invited_at: string;
      org_id: string;
      org_slug: string;
      org_name: string;
      subscription_status: string | null;
    }>) {
      const status = s.subscription_status ? `, subscription ${s.subscription_status}` : "";
      items.push({
        kind: "signup_approved_unpaid",
        severity: "high",
        title: "Approved signup unpaid after 3 days",
        detail: `${s.work_email} for ${s.org_name ?? s.org_slug}, invited ${String(s.invited_at).slice(0, 10)}${status}`,
        target_type: "signup",
        target_id: s.id,
      });
    }

    // Self-serve signups whose org is still inactive after 3 days.
    const selfServeUnpaid = await sql`
      select
        s.id,
        s.work_email,
        s.created_at,
        o.id as org_id,
        o.slug as org_slug,
        o.name as org_name,
        b.subscription_status
      from signups s
      join organization_memberships m on m.user_id = s.owner_user_id
      join organizations o on o.id = m.org_id
      left join org_billing b on b.org_id = o.id
      where s.owner_user_id is not null
        and s.invite_id is null
        and s.created_at <= now() - interval '3 days'
        and s.paid_at is null
        and o.status = 'inactive'
      order by s.created_at asc
      limit 50
    `;
    for (const s of selfServeUnpaid as Array<{
      id: string;
      work_email: string;
      created_at: string;
      org_id: string;
      org_slug: string;
      org_name: string;
      subscription_status: string | null;
    }>) {
      const status = s.subscription_status ? `, subscription ${s.subscription_status}` : "";
      items.push({
        kind: "signup_self_serve_unpaid",
        severity: "medium",
        title: "Self-serve signup unpaid after 3 days",
        detail: `${s.work_email} for ${s.org_name ?? s.org_slug}, created ${String(s.created_at).slice(0, 10)}${status}`,
        target_type: "signup",
        target_id: s.id,
      });
    }

    // Orgs past_due / unpaid by subscription_status.
    const billingProblem = await sql`
      select o.id, o.name, o.slug, b.subscription_status
      from organizations o
      join org_billing b on b.org_id = o.id
      where b.subscription_status in ('past_due', 'unpaid', 'incomplete')
      order by o.created_at desc
      limit 50
    `;
    for (const o of billingProblem as Array<{
      id: string;
      name: string;
      slug: string;
      subscription_status: string;
    }>) {
      items.push({
        kind: "subscription_problem",
        severity: "high",
        title: `Subscription ${o.subscription_status}`,
        detail: o.name ?? o.slug,
        target_type: "organization",
        target_id: o.id,
      });
    }

    // Active orgs with no usage in last 14 days (possible onboarding stall).
    const stalled = await sql`
      select o.id, o.name, o.slug
      from organizations o
      where o.status = 'active'
        and not exists (
          select 1 from usage_daily ud
          where ud.org_id = o.id
            and ud.actor_user_id is null
            and ud.model_calls > 0
            and ud.day > (now() - interval '14 days')::date
        )
      order by o.created_at desc
      limit 25
    `;
    for (const o of stalled as Array<{ id: string; name: string; slug: string }>) {
      items.push({
        kind: "onboarding_stall",
        severity: "low",
        title: "Active org with no recent usage",
        detail: o.name ?? o.slug,
        target_type: "organization",
        target_id: o.id,
      });
    }

    // Stripe-side items: open invoices + payout hold.
    if (isStripeConfigured()) {
      try {
        const stripe = getStripe();
        const open = await stripe.invoices.list({ status: "open", limit: 25 });
        for (const inv of open.data) {
          items.push({
            kind: "invoice_open",
            severity: "high",
            title: "Unpaid invoice",
            detail: `${inv.customer_email ?? inv.customer ?? "unknown"} — ${(inv.amount_due / 100).toFixed(2)} ${inv.currency.toUpperCase()}`,
            target_type: "invoice",
            target_id: inv.id ?? null,
          });
        }
        const account = await stripe.accounts.retrieveCurrent();
        if (account.payouts_enabled === false) {
          items.push({
            kind: "payout_hold",
            severity: "high",
            title: "Payouts disabled on Stripe account",
            detail:
              (account.requirements?.disabled_reason as string | null | undefined) ??
              "under Stripe review",
            target_type: "stripe_account",
            target_id: account.id,
          });
        }
      } catch {
        // Stripe read may be restricted; skip Stripe items rather than failing.
      }
    }

    const order = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => order[a.severity] - order[b.severity]);

    return Response.json({ items, count: items.length }, { status: 200 });
  } catch (err) {
    return routeError("platform action queue failed", err);
  }
}
