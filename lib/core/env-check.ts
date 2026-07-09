// Small assertions for required environment variables.
//
// These run inside serverless request handlers, so they throw with a consistent,
// actionable message — they must never process.exit(). Use requiredEnv() at the
// point where a variable is first needed, or the assert helpers to validate a
// whole group up front.

/** Return the value of a required env var, or throw a consistent, actionable error. */
export function requiredEnv(name: string, purpose?: string): string {
  const value = process.env[name];
  if (value) return value;
  throw new Error(
    `${name} is not set${purpose ? ` (${purpose})` : ""}. Add it to the environment (e.g. the Vercel project's env vars) and redeploy.`,
  );
}

/** Assert the env vars every deployment needs regardless of enabled features. */
export function assertRequiredServerEnv(): void {
  requiredEnv("DATABASE_URL", "Postgres connection string");
  requiredEnv("FREGE_API_KEY_SALT", "salt for hashing API keys");
  requiredEnv("IP_HASH_SALT", "salt for hashing client IPs");
  assertStripeEnv();
}

/**
 * Assert the Stripe-dependent env vars, but only when Stripe is enabled
 * (STRIPE_SECRET_KEY set). Billing is optional per deployment.
 */
export function assertStripeEnv(): void {
  if (!process.env.STRIPE_SECRET_KEY) return;
  requiredEnv("STRIPE_WEBHOOK_SECRET", "verifies Stripe webhook signatures");
  requiredEnv("STRIPE_PRICE_SOLO_MONTHLY", "Stripe price id for the solo plan");
  requiredEnv("STRIPE_PRICE_TEAM_MONTHLY", "Stripe price id for the monthly team plan");
  requiredEnv("STRIPE_PRICE_TEAM_ANNUAL", "Stripe price id for the annual team plan");
}
