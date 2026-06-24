import Stripe from "stripe";

export type PlanKey = "solo" | "team-monthly" | "team-annual";

export type PlanConfig = {
  key: PlanKey;
  plan: "solo" | "team";
  interval: "monthly" | "annual";
  priceId: string | undefined;
  perSeat: boolean;
};

// Price IDs come from env so the same code runs in test and live without edits.
export function planConfigs(): Record<PlanKey, PlanConfig> {
  return {
    solo: {
      key: "solo",
      plan: "solo",
      interval: "monthly",
      priceId: process.env.STRIPE_PRICE_SOLO_MONTHLY,
      perSeat: false,
    },
    "team-monthly": {
      key: "team-monthly",
      plan: "team",
      interval: "monthly",
      priceId: process.env.STRIPE_PRICE_TEAM_MONTHLY,
      perSeat: true,
    },
    "team-annual": {
      key: "team-annual",
      plan: "team",
      interval: "annual",
      priceId: process.env.STRIPE_PRICE_TEAM_ANNUAL,
      perSeat: true,
    },
  };
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let cachedClient: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("stripe_not_configured");
  }
  if (!cachedClient) {
    cachedClient = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
  }
  return cachedClient;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("stripe_webhook_not_configured");
  return secret;
}

export function appBaseUrl(req: Request): string {
  return process.env.FREGE_PUBLIC_BASE_URL ?? new URL(req.url).origin;
}

export type StripeRecurringRevenue = {
  mrrCents: number;
  arrCents: number;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
};

export type StripeCustomerRevenue = {
  totalChargedCents: number;
  totalRefundedCents: number;
  netRevenueCents: number;
  chargeCount: number;
};

export type StripeCustomerRevenueSummary = {
  totals: StripeCustomerRevenue;
  unmapped: StripeCustomerRevenue;
  byCustomer: Map<string, StripeCustomerRevenue>;
};

const activeSubscriptionStatuses = new Set(["active", "trialing"]);
const attentionSubscriptionStatuses = new Set(["past_due", "unpaid"]);

function emptyCustomerRevenue(): StripeCustomerRevenue {
  return {
    totalChargedCents: 0,
    totalRefundedCents: 0,
    netRevenueCents: 0,
    chargeCount: 0,
  };
}

function addChargeRevenue(
  revenue: StripeCustomerRevenue,
  chargedCents: number,
  refundedCents: number,
) {
  revenue.totalChargedCents += chargedCents;
  revenue.totalRefundedCents += refundedCents;
  revenue.netRevenueCents += chargedCents - refundedCents;
  revenue.chargeCount += 1;
}

function priceUnitAmountCents(price: Stripe.Price): number {
  if (typeof price.unit_amount === "number") return price.unit_amount;
  if (price.unit_amount_decimal) return Number.parseFloat(String(price.unit_amount_decimal));
  return 0;
}

export function subscriptionMrrCents(subscription: Stripe.Subscription): number {
  let mrrCents = 0;
  for (const item of subscription.items.data) {
    const price = item.price;
    const quantity = item.quantity ?? 1;
    const amount = priceUnitAmountCents(price) * quantity;
    const interval = price.recurring?.interval;
    const intervalCount = price.recurring?.interval_count ?? 1;

    if (interval === "year") mrrCents += amount / (12 * intervalCount);
    else if (interval === "week") mrrCents += (amount * 52) / (12 * intervalCount);
    else if (interval === "day") mrrCents += (amount * 365) / (12 * intervalCount);
    else mrrCents += amount / intervalCount;
  }
  return mrrCents;
}

export async function computeRecurringRevenue(stripe: Stripe): Promise<StripeRecurringRevenue> {
  let mrrCents = 0;
  let activeSubscriptions = 0;
  let pastDueSubscriptions = 0;

  for await (const subscription of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    if (activeSubscriptionStatuses.has(subscription.status)) {
      activeSubscriptions += 1;
      mrrCents += subscriptionMrrCents(subscription);
    }
    if (attentionSubscriptionStatuses.has(subscription.status)) pastDueSubscriptions += 1;
  }

  const roundedMrrCents = Math.round(mrrCents);
  return {
    mrrCents: roundedMrrCents,
    arrCents: roundedMrrCents * 12,
    activeSubscriptions,
    pastDueSubscriptions,
  };
}

function chargeCustomerId(charge: Stripe.Charge): string | null {
  const customer = charge.customer;
  if (typeof customer === "string") return customer;
  if (customer && "id" in customer) return customer.id;
  return null;
}

function ensureCustomerRevenue(
  byCustomer: Map<string, StripeCustomerRevenue>,
  customerId: string,
): StripeCustomerRevenue {
  const existing = byCustomer.get(customerId);
  if (existing) return existing;
  const revenue = emptyCustomerRevenue();
  byCustomer.set(customerId, revenue);
  return revenue;
}

export async function computeCustomerRevenueFromCharges(
  stripe: Stripe,
  knownCustomerIds?: Iterable<string>,
): Promise<StripeCustomerRevenueSummary> {
  const knownCustomers = knownCustomerIds ? new Set(knownCustomerIds) : null;
  const totals = emptyCustomerRevenue();
  const unmapped = emptyCustomerRevenue();
  const byCustomer = new Map<string, StripeCustomerRevenue>();

  for await (const charge of stripe.charges.list({ limit: 100 })) {
    if (charge.status !== "succeeded") continue;

    const captured = (charge as { amount_captured?: number | null }).amount_captured;
    const chargedCents = typeof captured === "number" ? captured : charge.amount;
    const refundedCents = charge.amount_refunded ?? 0;
    const customerId = chargeCustomerId(charge);

    addChargeRevenue(totals, chargedCents, refundedCents);

    if (!customerId || (knownCustomers && !knownCustomers.has(customerId))) {
      addChargeRevenue(unmapped, chargedCents, refundedCents);
      continue;
    }

    addChargeRevenue(ensureCustomerRevenue(byCustomer, customerId), chargedCents, refundedCents);
  }

  return { totals, unmapped, byCustomer };
}
