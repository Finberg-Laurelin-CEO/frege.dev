export const SESSION_COOKIE = "frege_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const APP_PARENT_DOMAIN = "frege.dev";

// Share sessions across frege.dev and brain.frege.dev only. Localhost and
// preview deploys stay host-only so cookies cannot leak across unrelated hosts.
export function cookieDomainForHost(host: string | null): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (hostname === APP_PARENT_DOMAIN || hostname.endsWith(`.${APP_PARENT_DOMAIN}`)) {
    return `.${APP_PARENT_DOMAIN}`;
  }
  return null;
}

export function sessionCookie(rawToken: string, host?: string | null): string {
  const domain = cookieDomainForHost(host ?? null);
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}`,
    "Path=/",
    domain ? `Domain=${domain}` : "",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(host?: string | null): string {
  const domain = cookieDomainForHost(host ?? null);
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    domain ? `Domain=${domain}` : "",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
