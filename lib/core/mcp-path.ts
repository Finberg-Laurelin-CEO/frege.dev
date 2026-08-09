const MAX_DECODE_PASSES = 3;

function withoutQueryOrFragment(value: string): string {
  const end = value.search(/[?#]/);
  return end === -1 ? value : value.slice(0, end);
}

function slashNormalized(value: string): string {
  const slashed = withoutQueryOrFragment(value).replace(/\\/g, "/");
  return `/${slashed.replace(/^\/+/, "")}`;
}

function isMcpPrefix(value: string): boolean {
  return slashNormalized(value).toLowerCase().startsWith("/mcp");
}

export function rawPathnameFromUrl(url: string): string {
  const scheme = url.indexOf("://");
  const pathStart = scheme === -1 ? 0 : url.indexOf("/", scheme + 3);
  if (pathStart === -1) return "/";
  return withoutQueryOrFragment(url.slice(pathStart));
}

// MCP requests carry credentials and must never enter a canonicalization or
// cross-authority redirect. Check bounded decoded/normalized variants so encoded
// separators, casing, backslashes, and dot segments fail
// closed before normal marketing/brain/admin routing runs.
export function isMcpCredentialPath(pathname: string): boolean {
  let candidates = new Set([withoutQueryOrFragment(pathname)]);

  for (let pass = 0; pass <= MAX_DECODE_PASSES; pass += 1) {
    const next = new Set<string>();
    for (const candidate of candidates) {
      const slashed = slashNormalized(candidate);
      if (isMcpPrefix(slashed)) return true;
      next.add(slashed);

      try {
        const normalized = new URL(slashed, "https://frege.invalid").pathname;
        if (isMcpPrefix(normalized)) return true;
        next.add(normalized);
      } catch {
        // Keep evaluating the raw form; malformed encoding must never turn a
        // known MCP prefix into a redirect.
      }

      try {
        const decoded = decodeURIComponent(candidate);
        if (isMcpPrefix(decoded)) return true;
        next.add(decoded);
      } catch {
        // Invalid escapes are not decoded by this boundary.
      }
    }
    candidates = next;
  }

  return false;
}
