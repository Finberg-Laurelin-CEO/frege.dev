// The customer-facing base URL (the public marketing/app site), used for links
// we send to prospects/customers — e.g. invite emails. This must NOT be the
// admin request origin, which is the operations console subdomain.
//
// Falls back to the canonical production domain so links are never built against
// an admin host even if the env var is unset.
export function customerBaseUrl(): string {
  const configured = process.env.FREGE_PUBLIC_BASE_URL?.trim();
  return (configured && configured.replace(/\/+$/, "")) || "https://frege.dev";
}

export function customerAppBaseUrl(): string {
  const configured = process.env.FREGE_APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const publicBase = customerBaseUrl();
  if (publicBase === "https://frege.dev") return "https://brain.frege.dev";
  return publicBase;
}

// Base URL for OAuth redirect URIs. On production frege.dev hosts the callback
// lives on the app host (brain.frege.dev) so the registered redirect URI is a
// single stable URL. On localhost / preview deploys there is no brain.*
// subdomain, so the callback stays on the requesting host — the operator
// registers that host's callback URL with the provider explicitly.
export function oauthCallbackBaseUrl(host?: string | null): string {
  const hostname = host?.split(":")[0]?.toLowerCase() ?? "";
  const isFregeHost = hostname === "frege.dev" || hostname.endsWith(".frege.dev");
  if (host && hostname && !isFregeHost) {
    const proto = hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https";
    return `${proto}://${host}`;
  }
  return customerAppBaseUrl();
}
