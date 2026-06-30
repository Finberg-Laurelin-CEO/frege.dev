"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  DEMO_CONCEPTS,
  DEMO_DOCUMENT_LINKS,
  DEMO_DOCUMENTS,
  DEMO_ROLES,
  type DemoDocument,
  type DemoRole,
} from "@/lib/prototype/demo-data";
import type { SensitivityLabel } from "@/lib/prototype/types";
import VaultGraphTab from "../VaultGraphTab";
import { Badge, eyebrow, panel } from "./ui";

function canRead(role: DemoRole, document: DemoDocument): boolean {
  return role.allowedLabels.includes(document.sensitivity);
}

function matchesQuery(document: DemoDocument, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [document.title, document.path, document.summary, document.bodyMd, document.tags.join(" "), document.sensitivity]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/\.md$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document"
  );
}

export default function KnowledgeSection({
  roleSlug,
  query,
  selectedSlug,
  onSelectSlug,
}: {
  roleSlug: DemoRole["slug"];
  query: string;
  selectedSlug: string;
  onSelectSlug: (slug: string) => void;
}) {
  const [view, setView] = useState<"documents" | "graph">("documents");
  const [documents, setDocuments] = useState<DemoDocument[]>(DEMO_DOCUMENTS);
  const [showWrite, setShowWrite] = useState(false);
  const [proposalSummary, setProposalSummary] = useState("Tighten the wording and keep the approval threshold explicit.");
  const [proposalBody, setProposalBody] = useState(
    "# Customer Refund Policy\n\nSupport can approve eligible refunds under $250. Larger refunds still require manager approval.",
  );
  const [localProposal, setLocalProposal] = useState<{ slug: string; summary: string } | null>(null);
  const [newTitle, setNewTitle] = useState("Partner Escalation Notes");
  const [newSensitivity, setNewSensitivity] = useState<SensitivityLabel>("internal");
  const [newBody, setNewBody] = useState("# Partner Escalation Notes\n\nPartner issues should be assigned an owner before handoff.");

  const role = DEMO_ROLES.find((r) => r.slug === roleSlug) ?? DEMO_ROLES[0]!;

  const visibleDocs = useMemo(() => documents.filter((d) => canRead(role, d)), [documents, role]);
  const filteredDocs = useMemo(() => visibleDocs.filter((d) => matchesQuery(d, query)), [visibleDocs, query]);
  const hiddenCount = documents.length - visibleDocs.length;

  const doc = visibleDocs.find((d) => d.slug === selectedSlug) ?? filteredDocs[0] ?? visibleDocs[0] ?? null;

  const links = useMemo(() => {
    if (!doc) return [];
    return DEMO_DOCUMENT_LINKS.flatMap((link) => {
      const outbound = link.sourceSlug === doc.slug;
      const inbound = link.targetSlug === doc.slug;
      if (!outbound && !inbound) return [];
      const neighborSlug = outbound ? link.targetSlug : link.sourceSlug;
      const neighbor = documents.find((d) => d.slug === neighborSlug);
      if (!neighbor || !canRead(role, neighbor)) return [];
      return [{ ...link, direction: outbound ? "→" : "←", neighbor }];
    });
  }, [doc, documents, role]);

  const hiddenLinks = useMemo(() => {
    if (!doc) return 0;
    return DEMO_DOCUMENT_LINKS.filter((link) => {
      const touches = link.sourceSlug === doc.slug || link.targetSlug === doc.slug;
      if (!touches) return false;
      const neighborSlug = link.sourceSlug === doc.slug ? link.targetSlug : link.sourceSlug;
      const neighbor = documents.find((d) => d.slug === neighborSlug);
      return Boolean(neighbor && !canRead(role, neighbor));
    }).length;
  }, [doc, documents, role]);

  const concepts = useMemo(() => {
    if (!doc) return [];
    return DEMO_CONCEPTS.filter((c) => c.documentSlugs.includes(doc.slug));
  }, [doc]);

  const pendingProposal =
    doc && doc.slug === "customer-refunds" && !localProposal
      ? { summary: "Clarify the $250 threshold wording", meta: "frg_writer · 13:40 · base rev 3" }
      : localProposal && doc && localProposal.slug === doc.slug
        ? { summary: localProposal.summary, meta: `${role.keyPrefix} · just now · pending` }
        : null;

  function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!doc || !role.capabilities.canUpdateDocs) return;
    setLocalProposal({ slug: doc.slug, summary: proposalSummary.trim() || "Proposed wording update" });
    setShowWrite(false);
  }

  function createLocalDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role.capabilities.canCreateDocs || !role.allowedLabels.includes(newSensitivity)) return;
    const slug = slugify(newTitle);
    const next: DemoDocument = {
      id: `doc_${slug}_${documents.length + 1}`,
      slug,
      path: `drafts/${slug}.md`,
      title: newTitle.trim() || "Untitled Document",
      sensitivity: newSensitivity,
      status: "published",
      tags: ["draft", "local"],
      summary: newBody.replace(/^#+\s+/gm, "").replace(/\s+/g, " ").trim().slice(0, 180),
      bodyMd: newBody.trim(),
      revisionNumber: 1,
      updatedAt: new Date().toISOString(),
    };
    setDocuments((cur) => [next, ...cur.filter((d) => d.slug !== slug)]);
    onSelectSlug(slug);
    setShowWrite(false);
  }

  const toggleBtn = (key: "documents" | "graph", label: string) => {
    const active = view === key;
    return (
      <button
        type="button"
        onClick={() => setView(key)}
        style={{
          minHeight: 30,
          padding: "0 12px",
          fontSize: 12,
          border: `1px solid ${active ? "var(--green)" : "var(--line-strong)"}`,
          background: active ? "var(--green-tint)" : "var(--surface)",
          color: active ? "var(--green-dark)" : "var(--muted)",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {toggleBtn("documents", "documents")}
        {toggleBtn("graph", "vault graph")}
      </div>

      {view === "graph" ? (
        <section style={panel}>
          <VaultGraphTab />
        </section>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 18, alignItems: "start" }}>
          <section style={panel}>
            <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 400, letterSpacing: "0.04em", color: "var(--ink)" }}>documents</h2>
              <span style={{ fontSize: 11, color: "var(--faint)" }}>{filteredDocs.length} visible</span>
            </div>
            <div className="frgscroll" style={{ maxHeight: 600, overflowY: "auto" }}>
              {filteredDocs.map((d) => {
                const active = d.slug === doc?.slug;
                return (
                  <button
                    key={d.slug}
                    type="button"
                    onClick={() => onSelectSlug(d.slug)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--line)",
                      borderLeft: `2px solid ${active ? "var(--green)" : "transparent"}`,
                      background: active ? "var(--green-tint)" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "var(--ink)" }}>{d.title}</span>
                      <Badge tone={d.sensitivity}>{d.sensitivity}</Badge>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>{d.path}</div>
                  </button>
                );
              })}
              {filteredDocs.length === 0 ? (
                <p style={{ padding: "14px 16px", fontSize: 12, color: "var(--muted)" }}>No visible documents match this query.</p>
              ) : null}
            </div>
            {hiddenCount > 0 ? (
              <div style={{ padding: "11px 16px", borderTop: "1px solid var(--line)", fontSize: 11.5, color: "#8a4242", background: "var(--restricted-bg)" }}>
                ✗ {hiddenCount} hidden from {role.name} · outside this role&apos;s trust zone
              </div>
            ) : null}
          </section>

          <section style={{ ...panel, padding: "22px 24px" }}>
            {doc ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, borderBottom: "1px solid var(--line)", paddingBottom: 14, marginBottom: 16 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 400, color: "var(--ink)" }}>{doc.title}</h2>
                    <div style={{ marginTop: 5, fontSize: 12, color: "var(--muted)" }}>
                      {doc.path} · rev {doc.revisionNumber} · {doc.tags.join(" / ")}
                    </div>
                  </div>
                  <Badge tone={doc.sensitivity}>{doc.sensitivity}</Badge>
                </div>

                <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-2)", fontFamily: "var(--mono)" }}>{doc.bodyMd}</pre>

                <div style={{ margin: "22px 0 0", borderTop: "1px solid var(--line)", paddingTop: 18 }}>
                  <div style={{ ...eyebrow, marginBottom: 12 }}>
                    <span style={{ color: "var(--faint)" }}>// </span>semantic context
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>linked documents</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {links.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => onSelectSlug(l.neighbor.slug)}
                            style={{ textAlign: "left", padding: "9px 11px", border: "1px solid var(--line)", background: "var(--surface-mute)" }}
                          >
                            <div style={{ fontSize: 12.5, color: "var(--ink)" }}>
                              {l.direction} {l.neighbor.title}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                              {l.linkType} · {Math.round(l.confidence * 100)}%
                            </div>
                          </button>
                        ))}
                        {hiddenLinks > 0 ? (
                          <div style={{ fontSize: 11, color: "#8a4242" }}>✗ {hiddenLinks} linked doc hidden from this role</div>
                        ) : null}
                        {links.length === 0 && hiddenLinks === 0 ? (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>No readable neighbors.</div>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>concepts</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {concepts.map((c) => (
                          <div key={c.id} style={{ padding: "9px 11px", border: "1px solid var(--line)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 12.5, color: "var(--ink)" }}>{c.name}</span>
                              <span style={{ fontSize: 11, color: "var(--green)" }}>{Math.round(c.confidence * 100)}%</span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{c.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {pendingProposal ? (
                  <div style={{ marginTop: 18, border: "1px solid var(--internal-bd)", background: "var(--internal-bg)", padding: "13px 15px" }}>
                    <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink-2)", marginBottom: 6 }}>▸ pending proposal</div>
                    <div style={{ fontSize: 13, color: "var(--ink)" }}>{pendingProposal.summary}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{pendingProposal.meta}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                      <button
                        type="button"
                        onClick={() => setLocalProposal(null)}
                        style={{ minHeight: 32, padding: "0 14px", border: "1px solid var(--green-dark)", background: "var(--green-dark)", color: "#fff", fontSize: 12 }}
                      >
                        accept revision
                      </button>
                      <button
                        type="button"
                        onClick={() => setLocalProposal(null)}
                        style={{ minHeight: 32, padding: "0 14px", border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--ink)", fontSize: 12 }}
                      >
                        reject
                      </button>
                    </div>
                  </div>
                ) : null}

                {role.capabilities.canUpdateDocs || role.capabilities.canCreateDocs ? (
                  <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                    <button type="button" onClick={() => setShowWrite((s) => !s)} style={{ fontSize: 12, color: "var(--green)" }}>
                      {showWrite ? "− hide write actions" : "+ propose a revision or create a document"}
                    </button>
                    {showWrite ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
                        {role.capabilities.canUpdateDocs ? (
                          <form onSubmit={submitProposal} style={{ display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--line)", background: "var(--surface-mute)", padding: 14 }}>
                            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 400, color: "var(--ink)" }}>propose revision</h3>
                            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)" }}>
                              target
                              <input readOnly value={doc.slug} style={inputStyle} />
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)" }}>
                              summary
                              <input value={proposalSummary} onChange={(e) => setProposalSummary(e.target.value)} style={inputStyle} />
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)" }}>
                              body
                              <textarea value={proposalBody} onChange={(e) => setProposalBody(e.target.value)} rows={5} style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }} />
                            </label>
                            <button type="submit" disabled={!proposalBody.trim()} style={primaryBtn}>create proposal</button>
                          </form>
                        ) : null}
                        {role.capabilities.canCreateDocs ? (
                          <form onSubmit={createLocalDocument} style={{ display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--line)", background: "var(--surface-mute)", padding: 14 }}>
                            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 400, color: "var(--ink)" }}>create document</h3>
                            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)" }}>
                              title
                              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={inputStyle} />
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)" }}>
                              sensitivity
                              <select value={newSensitivity} onChange={(e) => setNewSensitivity(e.target.value as SensitivityLabel)} style={inputStyle}>
                                <option value="public">public</option>
                                <option value="internal">internal</option>
                                <option value="restricted">restricted</option>
                              </select>
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)" }}>
                              body
                              <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={5} style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }} />
                            </label>
                            <button
                              type="submit"
                              disabled={!role.allowedLabels.includes(newSensitivity) || !newTitle.trim() || !newBody.trim()}
                              style={primaryBtn}
                            >
                              create local doc
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>Nothing visible to this role.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 34,
  padding: "0 10px",
  border: "1px solid var(--line-strong)",
  borderRadius: 0,
  background: "var(--surface)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: 13,
};

const primaryBtn: React.CSSProperties = {
  minHeight: 34,
  padding: "0 14px",
  border: "1px solid var(--green-dark)",
  background: "var(--green-dark)",
  color: "#fff",
  fontSize: 12,
  alignSelf: "flex-start",
};
