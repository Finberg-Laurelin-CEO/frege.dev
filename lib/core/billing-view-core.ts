// Pure billing-view state logic shared by the console billing panel (client)
// and the billing summary route (server). Keeping the branching here makes it
// unit-testable without React or a database.

export function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

// Row shape read from org_billing by the summary route.
export type OrgBillingSummaryRow = {
  plan: string | null;
  billing_interval: string | null;
  seats: number | null;
  subscription_status: string | null;
  current_period_end: Date | string | null;
  updated_at: Date | string | null;
  stripe_customer_id: string | null;
};

// The billing block of GET /api/v1/billing/summary. The raw Stripe customer id
// stays server-side; the panel only needs to know whether one exists so it can
// tell a Stripe-managed subscription apart from a staff-activated org.
export type BillingSummaryPayload = {
  plan: string | null;
  billing_interval: string | null;
  seats: number | null;
  subscription_status: string | null;
  current_period_end: string | null;
  updated_at: string | null;
  has_stripe_customer: boolean;
};

export function billingSummaryFromRow(row: OrgBillingSummaryRow | null | undefined): BillingSummaryPayload | null {
  if (!row) return null;
  return {
    plan: row.plan,
    billing_interval: row.billing_interval,
    seats: row.seats,
    subscription_status: row.subscription_status,
    current_period_end: toIsoString(row.current_period_end),
    updated_at: toIsoString(row.updated_at),
    has_stripe_customer: Boolean(row.stripe_customer_id),
  };
}

export type BillingPanelStatus = { label: string; detail: string };

export type BillingPanelView =
  | { kind: "active"; stripeManaged: boolean }
  | { kind: "checkout"; status: BillingPanelStatus };

// Decides which billing panel to render for an org the caller can manage.
//
// "active": the org is already billed — activated by billing (org status
// 'active') or carrying any Stripe subscription record (including past_due /
// canceled, where the Stripe portal is the recovery surface). This view shows
// the current plan, invoices, and portal access; never the plan picker.
// `stripeManaged` is false for orgs activated without a Stripe customer
// (staff/promo activation), where billing is handled by Frege staff and there
// is no portal to open.
//
// "checkout": the org has never been billed — keep the plan picker and the
// "Start billing with Stripe" flow.
export function resolveBillingPanelView(input: {
  emailVerified: boolean;
  orgStatus: string | null | undefined;
  subscriptionStatus: string | null | undefined;
  hasLiveSubscription: boolean;
  hasStripeCustomer: boolean;
}): BillingPanelView {
  const billingActive =
    input.orgStatus === "active" || input.hasLiveSubscription || Boolean(input.subscriptionStatus);

  if (billingActive) {
    return {
      kind: "active",
      stripeManaged: input.hasLiveSubscription || input.hasStripeCustomer,
    };
  }

  if (!input.emailVerified) {
    return {
      kind: "checkout",
      status: {
        label: "email pending",
        detail: "Verify your email before starting Stripe billing.",
      },
    };
  }

  return {
    kind: "checkout",
    status: {
      label: "ready for billing",
      detail: "Choose a plan and start secure checkout with Stripe.",
    },
  };
}
