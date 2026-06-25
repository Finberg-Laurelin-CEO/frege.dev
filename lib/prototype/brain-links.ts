// Shared link parsing for the hosted brain. Used by:
//   - the writer (refreshBrainPageLinks) to auto-wire links on every revision
//   - the renderer (vault UI) to make [[wikilinks]] / frege://page links clickable
//   - the graph traversal helpers / MCP tools
// Keeping a single source of truth means the parser and renderer never drift.

export function slugifyBrain(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/\.md$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "page"
  );
}

export type ParsedLink = { slug: string; evidence: string };

// Match [[target]], [[target#heading]], [[target|display]] and
// [display](frege://page/slug) or [display](slug) markdown links.
const WIKI_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_PATTERN = /\[[^\]]+\]\((?:frege:\/\/page\/)?([a-zA-Z0-9][a-zA-Z0-9/_ .-]*)\)/g;

// Extract the set of distinct outgoing link slugs from a markdown body, each
// paired with the raw matched text as evidence. De-duped by slug (last wins),
// mirroring the original behavior in brain.ts.
export function parseBrainLinks(body: string): ParsedLink[] {
  const links = new Map<string, string>();

  for (const match of body.matchAll(WIKI_PATTERN)) {
    const slug = slugifyBrain(match[1] ?? "");
    if (slug) links.set(slug, match[0]);
  }

  for (const match of body.matchAll(MARKDOWN_PATTERN)) {
    const raw = String(match[1] ?? "").replace(/\.md$/i, "");
    const slug = slugifyBrain(raw.split("/").filter(Boolean).at(-1) ?? raw);
    if (slug) links.set(slug, match[0]);
  }

  return [...links.entries()].map(([slug, evidence]) => ({ slug, evidence }));
}
