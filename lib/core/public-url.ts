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
