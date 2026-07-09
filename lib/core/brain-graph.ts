// Graph traversal over the hosted brain (brain_pages + brain_links).
// Powers the agent MCP tools (page-links, traverse, find-connections) and the
// human vault UI. All queries are org-scoped and trust-zone filtered, matching
// the conventions in brain.ts.

import { getSql } from "@/lib/db";
import type { FregeActorContext } from "@/lib/core/actor-auth";
import type { TrustZone } from "@/lib/core/types";

// Both API-key actors and human sessions can read the graph. We only need the
// org id and the trust zones the caller may see. authenticateFregeActor already
// unifies API-key and session auth, so one reader covers agents and humans.
export type GraphReader = { orgId: string; trustZones: TrustZone[] };

export function readerForActor(actor: FregeActorContext): GraphReader {
  return {
    orgId: actor.organization.id,
    trustZones: actor.allowedLabels.includes("restricted") ? ["green", "red"] : ["green"],
  };
}

export type LinkEdge = {
  source_slug: string;
  target_slug: string;
  target_title: string | null;
  link_type: string;
  confidence: number;
  evidence: string;
  resolved: boolean;
};

export type PageLinks = {
  page: { slug: string; title: string };
  outgoing: LinkEdge[];
  backlinks: LinkEdge[];
  unresolved: LinkEdge[];
};

type PageRow = { id: string; slug: string; title: string };

async function findPage(r: GraphReader, slug: string): Promise<PageRow | null> {
  const sql = getSql();
  const rows = (await sql`
    select id, slug, title
    from brain_pages
    where org_id = ${r.orgId}
      and slug = ${slug}
      and status = 'published'
      and trust_zone = any(${r.trustZones}::text[])
    limit 1
  `) as PageRow[];
  return rows[0] ?? null;
}

// Outgoing links, incoming backlinks, and unresolved (dangling) links for a page.
export async function getPageLinks(r: GraphReader, slug: string): Promise<PageLinks | null> {
  const page = await findPage(r, slug);
  if (!page) return null;
  const sql = getSql();

  // Outgoing: links whose source is this page. Join targets to get titles and
  // filter targets to the visible trust zone. target_page_id null => unresolved.
  const outgoingRows = (await sql`
    select
      ${page.slug} as source_slug,
      bl.target_slug,
      tp.title as target_title,
      bl.link_type,
      bl.confidence,
      bl.evidence,
      (tp.id is not null) as resolved
    from brain_links bl
    left join brain_pages tp
      on tp.id = bl.target_page_id
      and tp.status = 'published'
      and tp.trust_zone = any(${r.trustZones}::text[])
    where bl.org_id = ${r.orgId}
      and bl.source_page_id = ${page.id}
    order by resolved desc, bl.target_slug asc
  `) as LinkEdge[];

  // Backlinks: links pointing at this page from other visible pages.
  const backlinkRows = (await sql`
    select
      sp.slug as source_slug,
      ${page.slug} as target_slug,
      sp.title as target_title,
      bl.link_type,
      bl.confidence,
      bl.evidence,
      true as resolved
    from brain_links bl
    join brain_pages sp
      on sp.id = bl.source_page_id
      and sp.status = 'published'
      and sp.trust_zone = any(${r.trustZones}::text[])
    where bl.org_id = ${r.orgId}
      and bl.target_page_id = ${page.id}
    order by sp.slug asc
  `) as LinkEdge[];

  return {
    page: { slug: page.slug, title: page.title },
    outgoing: outgoingRows.filter((e) => e.resolved),
    backlinks: backlinkRows,
    unresolved: outgoingRows.filter((e) => !e.resolved),
  };
}

export type GraphNode = { slug: string; title: string; link_count: number };
export type GraphEdge = { source: string; target: string; link_type: string };
export type Subgraph = {
  root: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// BFS outward from a page up to `depth` hops, following resolved links in both
// directions (a connection is a connection regardless of arrow direction, which
// is how an agent reasons about relatedness). Returns the induced subgraph.
export async function getNeighbors(
  r: GraphReader,
  slug: string,
  depth = 1,
  limit = 50,
): Promise<Subgraph | null> {
  const root = await findPage(r, slug);
  if (!root) return null;
  const sql = getSql();

  const visited = new Set<string>([root.slug]);
  let frontier = [root.slug];

  for (let hop = 0; hop < depth && visited.size < limit; hop++) {
    if (frontier.length === 0) break;
    const rows = (await sql`
      select sp.slug as source_slug, tp.slug as target_slug
      from brain_links bl
      join brain_pages sp on sp.id = bl.source_page_id
        and sp.status = 'published' and sp.trust_zone = any(${r.trustZones}::text[])
      join brain_pages tp on tp.id = bl.target_page_id
        and tp.status = 'published' and tp.trust_zone = any(${r.trustZones}::text[])
      where bl.org_id = ${r.orgId}
        and (sp.slug = any(${frontier}::text[]) or tp.slug = any(${frontier}::text[]))
    `) as Array<{ source_slug: string; target_slug: string }>;

    const next = new Set<string>();
    for (const row of rows) {
      for (const s of [row.source_slug, row.target_slug]) {
        if (!visited.has(s) && visited.size < limit) {
          visited.add(s);
          next.add(s);
        }
      }
    }
    frontier = [...next];
  }

  return buildSubgraph(r, root.slug, [...visited]);
}

// Build the induced subgraph (nodes + edges among them) for a set of slugs.
async function buildSubgraph(r: GraphReader, root: string | null, slugs: string[]): Promise<Subgraph> {
  const sql = getSql();
  if (slugs.length === 0) return { root, nodes: [], edges: [] };

  const nodes = (await sql`
    select
      bp.slug,
      bp.title,
      (select count(*)::int from brain_links bl
        where bl.org_id = ${r.orgId}
          and (bl.source_page_id = bp.id or bl.target_page_id = bp.id)) as link_count
    from brain_pages bp
    where bp.org_id = ${r.orgId}
      and bp.slug = any(${slugs}::text[])
      and bp.status = 'published'
      and bp.trust_zone = any(${r.trustZones}::text[])
    order by link_count desc, bp.slug asc
  `) as GraphNode[];

  const edges = (await sql`
    select sp.slug as source, tp.slug as target, bl.link_type
    from brain_links bl
    join brain_pages sp on sp.id = bl.source_page_id
    join brain_pages tp on tp.id = bl.target_page_id
    where bl.org_id = ${r.orgId}
      and sp.slug = any(${slugs}::text[])
      and tp.slug = any(${slugs}::text[])
      and sp.trust_zone = any(${r.trustZones}::text[])
      and tp.trust_zone = any(${r.trustZones}::text[])
  `) as GraphEdge[];

  return { root, nodes, edges };
}

// The whole vault as a graph (capped). Powers the global graph view.
export async function getVaultGraph(r: GraphReader, limit = 500): Promise<Subgraph> {
  const sql = getSql();
  const rows = (await sql`
    select slug from brain_pages
    where org_id = ${r.orgId}
      and status = 'published'
      and trust_zone = any(${r.trustZones}::text[])
    order by updated_at desc
    limit ${limit}
  `) as Array<{ slug: string }>;
  return buildSubgraph(r, null, rows.map((row) => row.slug));
}

export type VaultEntry = {
  slug: string;
  title: string;
  status: string;
  updated_at: Date | string;
  outgoing_count: number;
  backlink_count: number;
};

// Flat document list with link counts. Powers the vault list view.
export async function listVault(r: GraphReader, limit = 200): Promise<VaultEntry[]> {
  const sql = getSql();
  return (await sql`
    select
      bp.slug,
      bp.title,
      bp.status,
      bp.updated_at,
      (select count(*)::int from brain_links bl
        where bl.org_id = ${r.orgId} and bl.source_page_id = bp.id) as outgoing_count,
      (select count(*)::int from brain_links bl
        where bl.org_id = ${r.orgId} and bl.target_page_id = bp.id) as backlink_count
    from brain_pages bp
    where bp.org_id = ${r.orgId}
      and bp.status = 'published'
      and bp.trust_zone = any(${r.trustZones}::text[])
    order by bp.updated_at desc
    limit ${limit}
  `) as VaultEntry[];
}

export type ConnectionPath = {
  from: string;
  to: string;
  hops: number;
  path: Array<{ slug: string; title: string }>;
  edges: GraphEdge[];
};

// Shortest path between two pages following resolved links (undirected BFS).
// Answers "how is X connected to Y" — the relational query vector search can't.
export async function findConnections(
  r: GraphReader,
  fromSlug: string,
  toSlug: string,
  maxHops = 4,
): Promise<ConnectionPath | null> {
  const from = await findPage(r, fromSlug);
  const to = await findPage(r, toSlug);
  if (!from || !to) return null;
  if (from.slug === to.slug) {
    return { from: from.slug, to: to.slug, hops: 0, path: [{ slug: from.slug, title: from.title }], edges: [] };
  }

  const sql = getSql();
  const prev = new Map<string, string>();
  const visited = new Set<string>([from.slug]);
  let frontier = [from.slug];
  let found = false;

  for (let hop = 0; hop < maxHops && !found; hop++) {
    if (frontier.length === 0) break;
    const rows = (await sql`
      select sp.slug as source_slug, tp.slug as target_slug
      from brain_links bl
      join brain_pages sp on sp.id = bl.source_page_id
        and sp.status = 'published' and sp.trust_zone = any(${r.trustZones}::text[])
      join brain_pages tp on tp.id = bl.target_page_id
        and tp.status = 'published' and tp.trust_zone = any(${r.trustZones}::text[])
      where bl.org_id = ${r.orgId}
        and (sp.slug = any(${frontier}::text[]) or tp.slug = any(${frontier}::text[]))
    `) as Array<{ source_slug: string; target_slug: string }>;

    const next = new Set<string>();
    for (const row of rows) {
      const pairs: Array<[string, string]> = [
        [row.source_slug, row.target_slug],
        [row.target_slug, row.source_slug],
      ];
      for (const [a, b] of pairs) {
        if (frontier.includes(a) && !visited.has(b)) {
          visited.add(b);
          prev.set(b, a);
          next.add(b);
          if (b === to.slug) {
            found = true;
            break;
          }
        }
      }
      if (found) break;
    }
    frontier = [...next];
  }

  if (!found) return null;

  // Reconstruct the path from `to` back to `from`.
  const slugPath: string[] = [];
  let cursor: string | undefined = to.slug;
  while (cursor) {
    slugPath.unshift(cursor);
    cursor = prev.get(cursor);
  }

  const titled = (await sql`
    select slug, title from brain_pages
    where org_id = ${r.orgId} and slug = any(${slugPath}::text[])
  `) as Array<{ slug: string; title: string }>;
  const titleBySlug = new Map(titled.map((row) => [row.slug, row.title]));

  const path = slugPath.map((s) => ({ slug: s, title: titleBySlug.get(s) ?? s }));
  const edges: GraphEdge[] = [];
  for (let i = 0; i < slugPath.length - 1; i++) {
    edges.push({ source: slugPath[i], target: slugPath[i + 1], link_type: "path" });
  }

  return { from: from.slug, to: to.slug, hops: slugPath.length - 1, path, edges };
}
