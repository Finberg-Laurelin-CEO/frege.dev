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
