"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";

type VaultEntry = {
  slug: string;
  title: string;
  status: string;
  updated_at: string;
  outgoing_count: number;
  backlink_count: number;
};

type LinkEdge = {
  source_slug: string;
  target_slug: string;
  target_title: string | null;
  link_type: string;
  confidence: number | string;
  evidence: string;
  resolved: boolean;
};

type PageLinks = {
  page: { slug: string; title: string };
  outgoing: LinkEdge[];
  backlinks: LinkEdge[];
  unresolved: LinkEdge[];
};

type GraphNode = { slug: string; title: string; link_count: number };
type GraphEdge = { source: string; target: string; link_type: string };
type Subgraph = { root: string | null; nodes: GraphNode[]; edges: GraphEdge[] };

type ConnectionResult =
  | { connected: false }
  | {
      connected: true;
      from: string;
      to: string;
      hops: number;
      path: Array<{ slug: string; title: string }>;
      edges: GraphEdge[];
    };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

// Lay out a subgraph: root (or highest-degree node) in the center, the rest on a
// ring around it. Deterministic so the picture is stable across renders.
function layoutGraph(graph: Subgraph, width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 48;

  const ordered = [...graph.nodes].sort((a, b) => b.link_count - a.link_count);
  const center =
    (graph.root ? ordered.find((n) => n.slug === graph.root) : ordered[0]) ?? ordered[0] ?? null;
  const ring = ordered.filter((n) => n.slug !== center?.slug);

  const positions = new Map<string, { x: number; y: number }>();
  if (center) positions.set(center.slug, { x: cx, y: cy });
  ring.forEach((node, i) => {
    const angle = (i / Math.max(ring.length, 1)) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.slug, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  return { positions, center };
}

export default function VaultGraphTab() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [links, setLinks] = useState<PageLinks | null>(null);
  const [graph, setGraph] = useState<Subgraph | null>(null);
  const [depth, setDepth] = useState(2);

  const [connectFrom, setConnectFrom] = useState("");
  const [connectTo, setConnectTo] = useState("");
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const loadVault = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson<{ entries: VaultEntry[] }>("/api/v1/brain/vault");
      setEntries(data.entries);
      if (data.entries.length > 0 && !selectedSlug) {
        setSelectedSlug(data.entries[0]!.slug);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load vault");
    } finally {
      setLoading(false);
    }
  }, [selectedSlug]);

  useEffect(() => {
    void loadVault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever the selected page or depth changes, load its links + neighborhood.
  useEffect(() => {
    if (!selectedSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const [linksData, graphData] = await Promise.all([
          getJson<PageLinks>(`/api/v1/brain/pages/${encodeURIComponent(selectedSlug)}/links`),
          getJson<Subgraph>(`/api/v1/brain/graph?slug=${encodeURIComponent(selectedSlug)}&depth=${depth}`),
        ]);
        if (cancelled) return;
        setLinks(linksData);
        setGraph(graphData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load page graph");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSlug, depth]);

  const findConnection = useCallback(async () => {
    setConnectError(null);
    setConnection(null);
    if (!connectFrom || !connectTo) {
      setConnectError("pick both a source and a target page");
      return;
    }
    try {
      const data = await getJson<ConnectionResult>(
        `/api/v1/brain/connections?from=${encodeURIComponent(connectFrom)}&to=${encodeURIComponent(connectTo)}`,
      );
      setConnection(data);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "failed to find connection");
    }
  }, [connectFrom, connectTo]);

  const layout = useMemo(() => {
    if (!graph) return null;
    return layoutGraph(graph, 520, 420);
  }, [graph]);

  const titleBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) map.set(entry.slug, entry.title);
    if (graph) for (const node of graph.nodes) map.set(node.slug, node.title);
    return map;
  }, [entries, graph]);

  if (loading) {
    return <p className={styles.empty}>Loading vault…</p>;
  }

  if (error) {
    return (
      <div className={styles.forbidden}>
        <p>Could not load the vault: {error}</p>
        <button type="button" onClick={() => void loadVault()}>
          Retry
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className={styles.empty}>This org has no published brain pages yet.</p>;
  }

  return (
    <section className={styles.vaultView} aria-label="Live vault graph">
      <div className={styles.vaultGrid}>
        <aside className={styles.vaultList} aria-label="Vault pages">
          <div className={styles.panelHead}>
            <h2>Vault</h2>
            <span>{entries.length} pages</span>
          </div>
          <div className={styles.listScroll}>
            {entries.map((entry) => (
              <button
                key={entry.slug}
                type="button"
                className={entry.slug === selectedSlug ? styles.selectedDocument : styles.documentButton}
                onClick={() => setSelectedSlug(entry.slug)}
              >
                <span className={styles.documentTitle}>{entry.title}</span>
                <span className={styles.documentPath}>{entry.slug}</span>
                <span className={styles.vaultCounts}>
                  {entry.outgoing_count} out · {entry.backlink_count} in
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className={styles.vaultDetail}>
          <div className={styles.panelHead}>
            <div>
              <h2>{links?.page.title ?? selectedSlug}</h2>
              <p>{selectedSlug}</p>
            </div>
            <label className={styles.field}>
              <span>depth</span>
              <select value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
                <option value={1}>1 hop</option>
                <option value={2}>2 hops</option>
                <option value={3}>3 hops</option>
              </select>
            </label>
          </div>

          <div className={styles.graphCanvas} aria-label="Neighborhood graph">
            {graph && layout ? (
              <svg ref={svgRef} viewBox="0 0 520 420" role="img" aria-label="Brain graph">
                {graph.edges.map((edge, i) => {
                  const a = layout.positions.get(edge.source);
                  const b = layout.positions.get(edge.target);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={`${edge.source}-${edge.target}-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={styles.graphEdge}
                    />
                  );
                })}
                {graph.nodes.map((node) => {
                  const pos = layout.positions.get(node.slug);
                  if (!pos) return null;
                  const isCenter = node.slug === selectedSlug;
                  return (
                    <g
                      key={node.slug}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      className={styles.graphNodeGroup}
                      onClick={() => setSelectedSlug(node.slug)}
                    >
                      <circle
                        r={isCenter ? 12 : 7 + Math.min(node.link_count, 6)}
                        className={isCenter ? styles.graphNodeCenter : styles.graphNode}
                      />
                      <text y={-16} className={styles.graphLabel}>
                        {node.title}
                      </text>
                    </g>
                  );
                })}
              </svg>
            ) : (
              <p className={styles.empty}>No graph for this page.</p>
            )}
          </div>

          {links ? (
            <div className={styles.linkColumns}>
              <section>
                <h3>Outgoing ({links.outgoing.length})</h3>
                {links.outgoing.map((edge) => (
                  <button
                    key={`out-${edge.target_slug}`}
                    type="button"
                    className={styles.linkRow}
                    onClick={() => setSelectedSlug(edge.target_slug)}
                  >
                    <strong>{edge.target_title ?? edge.target_slug}</strong>
                    <em>{edge.link_type}</em>
                  </button>
                ))}
                {links.outgoing.length === 0 ? <p className={styles.empty}>None</p> : null}
              </section>
              <section>
                <h3>Backlinks ({links.backlinks.length})</h3>
                {links.backlinks.map((edge) => (
                  <button
                    key={`back-${edge.source_slug}`}
                    type="button"
                    className={styles.linkRow}
                    onClick={() => setSelectedSlug(edge.source_slug)}
                  >
                    <strong>{edge.target_title ?? edge.source_slug}</strong>
                    <em>{edge.link_type}</em>
                  </button>
                ))}
                {links.backlinks.length === 0 ? <p className={styles.empty}>None</p> : null}
              </section>
              <section>
                <h3>Unresolved ({links.unresolved.length})</h3>
                {links.unresolved.map((edge) => (
                  <div key={`unres-${edge.target_slug}`} className={styles.linkRow}>
                    <strong>{edge.target_slug}</strong>
                    <em>dangling</em>
                  </div>
                ))}
                {links.unresolved.length === 0 ? <p className={styles.empty}>None</p> : null}
              </section>
            </div>
          ) : null}

          <section className={styles.connectionPanel} aria-label="Find connections">
            <h3>Find a path between two pages</h3>
            <div className={styles.connectionControls}>
              <select value={connectFrom} onChange={(event) => setConnectFrom(event.target.value)}>
                <option value="">from…</option>
                {entries.map((entry) => (
                  <option key={`from-${entry.slug}`} value={entry.slug}>
                    {entry.title}
                  </option>
                ))}
              </select>
              <select value={connectTo} onChange={(event) => setConnectTo(event.target.value)}>
                <option value="">to…</option>
                {entries.map((entry) => (
                  <option key={`to-${entry.slug}`} value={entry.slug}>
                    {entry.title}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void findConnection()}>
                Find path
              </button>
            </div>
            {connectError ? <p className={styles.empty}>{connectError}</p> : null}
            {connection ? (
              connection.connected ? (
                <p className={styles.connectionPath}>
                  {connection.hops} hop{connection.hops === 1 ? "" : "s"}:{" "}
                  {connection.path.map((node, i) => (
                    <span key={node.slug}>
                      {i > 0 ? " → " : ""}
                      <button type="button" className={styles.pathHop} onClick={() => setSelectedSlug(node.slug)}>
                        {titleBySlug.get(node.slug) ?? node.title}
                      </button>
                    </span>
                  ))}
                </p>
              ) : (
                <p className={styles.empty}>No path found between these pages.</p>
              )
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}
