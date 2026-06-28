"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  DEMO_AUDIT_EVENTS,
  DEMO_CHUNKS,
  DEMO_CONCEPTS,
  DEMO_DOCUMENT_LINKS,
  DEMO_DOCUMENTS,
  DEMO_ROLES,
  type DemoAuditEvent,
  type DemoDocument,
  type DemoRole,
} from "@/lib/prototype/demo-data";
import type { SensitivityLabel } from "@/lib/prototype/types";
import styles from "./page.module.css";
import VaultGraphTab from "./VaultGraphTab";

type ConsoleTab = "documents" | "map" | "write" | "audit" | "vault";

const consoleTabs: Array<{ id: ConsoleTab; label: string }> = [
  { id: "documents", label: "Documents" },
  { id: "map", label: "Map" },
  { id: "write", label: "Write" },
  { id: "audit", label: "Audit" },
  { id: "vault", label: "Vault" },
];

type DemoProposal = {
  id: string;
  documentSlug: string;
  summary: string;
  proposedBodyMd: string;
  actor: string;
  createdAt: string;
};

function canRead(role: DemoRole, document: DemoDocument): boolean {
  return role.allowedLabels.includes(document.sensitivity);
}

function matchesQuery(document: DemoDocument, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const haystack = [
    document.title,
    document.path,
    document.summary,
    document.bodyMd,
    document.tags.join(" "),
    document.sensitivity,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
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

function sensitivityClass(label: SensitivityLabel): string {
  if (label === "restricted") return styles.restricted;
  if (label === "internal") return styles.internal;
  return styles.public;
}

function metadataText(metadata: DemoAuditEvent["metadata"]): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

export default function PrototypeConsole({ userEmail }: { userEmail?: string }) {
  const [roleSlug, setRoleSlug] = useState<DemoRole["slug"]>("reader");
  const [activeTab, setActiveTab] = useState<ConsoleTab>("documents");
  const [query, setQuery] = useState("refund");
  const [documents, setDocuments] = useState<DemoDocument[]>(DEMO_DOCUMENTS);
  const [selectedSlug, setSelectedSlug] = useState("customer-refunds");
  const [proposalSummary, setProposalSummary] = useState("Tighten the wording and keep the approval threshold explicit.");
  const [proposalBody, setProposalBody] = useState(
    "# Customer Refund Policy\n\nSupport can approve eligible refunds under $250. Larger refunds still require manager approval.",
  );
  const [proposals, setProposals] = useState<DemoProposal[]>([]);
  const [newTitle, setNewTitle] = useState("Partner Escalation Notes");
  const [newSensitivity, setNewSensitivity] = useState<SensitivityLabel>("internal");
  const [newBody, setNewBody] = useState(
    "# Partner Escalation Notes\n\nPartner issues should be assigned an owner before handoff.",
  );

  const activeRole = DEMO_ROLES.find((role) => role.slug === roleSlug) ?? DEMO_ROLES[0]!;

  const visibleDocuments = useMemo(
    () => documents.filter((document) => canRead(activeRole, document)),
    [activeRole, documents],
  );

  const filteredDocuments = useMemo(
    () => visibleDocuments.filter((document) => matchesQuery(document, query)),
    [query, visibleDocuments],
  );

  const selectedDocument =
    visibleDocuments.find((document) => document.slug === selectedSlug) ??
    filteredDocuments[0] ??
    visibleDocuments[0] ??
    null;

  const selectedLinks = useMemo(() => {
    if (!selectedDocument) return [];

    return DEMO_DOCUMENT_LINKS.flatMap((link) => {
      const isOutbound = link.sourceSlug === selectedDocument.slug;
      const isInbound = link.targetSlug === selectedDocument.slug;
      if (!isOutbound && !isInbound) return [];

      const neighborSlug = isOutbound ? link.targetSlug : link.sourceSlug;
      const neighbor = documents.find((document) => document.slug === neighborSlug);
      if (!neighbor || !canRead(activeRole, neighbor)) return [];

      return [
        {
          ...link,
          direction: isOutbound ? "outbound" : "inbound",
          neighbor,
        },
      ];
    });
  }, [activeRole, documents, selectedDocument]);

  const hiddenLinkCount = useMemo(() => {
    if (!selectedDocument) return 0;

    return DEMO_DOCUMENT_LINKS.filter((link) => {
      const touchesSelected = link.sourceSlug === selectedDocument.slug || link.targetSlug === selectedDocument.slug;
      if (!touchesSelected) return false;

      const neighborSlug = link.sourceSlug === selectedDocument.slug ? link.targetSlug : link.sourceSlug;
      const neighbor = documents.find((document) => document.slug === neighborSlug);
      return Boolean(neighbor && !canRead(activeRole, neighbor));
    }).length;
  }, [activeRole, documents, selectedDocument]);

  const selectedConcepts = useMemo(() => {
    if (!selectedDocument) return [];

    return DEMO_CONCEPTS.filter((concept) => concept.documentSlugs.includes(selectedDocument.slug)).map((concept) => ({
      ...concept,
      documents: concept.documentSlugs
        .map((slug) => documents.find((document) => document.slug === slug))
        .filter((document): document is DemoDocument => Boolean(document && canRead(activeRole, document))),
    }));
  }, [activeRole, documents, selectedDocument]);

  const selectedChunks = useMemo(() => {
    if (!selectedDocument) return [];
    return DEMO_CHUNKS.filter((chunk) => chunk.documentSlug === selectedDocument.slug);
  }, [selectedDocument]);

  function chooseDocument(slug: string) {
    setSelectedSlug(slug);
    setActiveTab("documents");
  }

  function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDocument || !activeRole.capabilities.canUpdateDocs) return;

    const createdAt = new Date().toISOString();
    setProposals((current) => [
      {
        id: `proposal_${createdAt}`,
        documentSlug: selectedDocument.slug,
        summary: proposalSummary.trim() || "Proposed wording update",
        proposedBodyMd: proposalBody.trim(),
        actor: activeRole.keyPrefix,
        createdAt,
      },
      ...current,
    ]);
    setActiveTab("audit");
  }

  function createLocalDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeRole.capabilities.canCreateDocs) return;
    if (!activeRole.allowedLabels.includes(newSensitivity)) return;

    const slug = slugify(newTitle);
    const createdAt = new Date().toISOString();
    const nextDocument: DemoDocument = {
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
      updatedAt: createdAt,
    };

    setDocuments((current) => [nextDocument, ...current.filter((document) => document.slug !== slug)]);
    setSelectedSlug(slug);
    setQuery("");
    setActiveTab("documents");
  }

  const proposalEvents: DemoAuditEvent[] = proposals.map((proposal) => ({
    id: proposal.id,
    action: "documents.proposal.created",
    resourceType: "document_revision_proposal",
    resourceSlug: proposal.documentSlug,
    actor: proposal.actor,
    createdAt: proposal.createdAt,
    metadata: {
      status: "pending",
      summary: proposal.summary,
    },
  }));
  const auditEvents = [...proposalEvents, ...DEMO_AUDIT_EVENTS];

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  }

  const tabCounts: Record<ConsoleTab, string> = {
    documents: String(filteredDocuments.length),
    map: selectedLinks.length > 0 ? String(selectedLinks.length) : hiddenLinkCount > 0 ? `${hiddenLinkCount} hidden` : "0",
    write: proposals.length > 0 ? String(proposals.length) : activeRole.capabilities.canCreateDocs ? "ready" : "locked",
    audit: activeRole.capabilities.canReadAudit ? String(auditEvents.length) : "locked",
    vault: "live",
  };

  return (
    <main id="main" className={styles.console}>
      <div className={styles.appShell}>
        <aside className={styles.sidebar} aria-label="Console navigation">
          <div className={styles.sidebarHeader}>
            <span className={styles.kicker}>Frege</span>
            <strong>Console</strong>
          </div>
          <nav className={styles.productNav} aria-label="Workspace links">
            <a className={styles.productNavActive} href="/console">Knowledge</a>
            <a href="/admin">Admin</a>
            <a href="/billing">Billing</a>
          </nav>
          <nav className={styles.viewNav} aria-label="Knowledge views">
            {consoleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? styles.activeView : undefined}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                <small>{tabCounts[tab.id]}</small>
              </button>
            ))}
          </nav>
          <div className={styles.sidebarMeta}>
            {userEmail ? <span>{userEmail}</span> : null}
            <span>{activeRole.name}</span>
            <code>{activeRole.keyPrefix}</code>
            <small>{activeRole.allowedLabels.join(" / ")}</small>
          </div>
          <button className={styles.logoutButton} type="button" onClick={logout}>Logout</button>
        </aside>

        <section className={styles.content}>
          <header className={styles.topbar}>
            <div className={styles.pageTitle}>
              <h1>Knowledge</h1>
              <p>{selectedDocument ? selectedDocument.path : "No document selected"}</p>
            </div>
            <div className={styles.controls} aria-label="Console controls">
              <label className={styles.field}>
                <span>role</span>
                <select value={roleSlug} onChange={(event) => setRoleSlug(event.target.value as DemoRole["slug"])}>
                  {DEMO_ROLES.map((role) => (
                    <option key={role.slug} value={role.slug}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>search</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="refund, incident, sales..." />
              </label>
            </div>
          </header>

          <section className={styles.workspace} aria-label="Knowledge workspace">
            <aside className={styles.documentList} aria-label="Visible documents">
              <div className={styles.panelHead}>
                <h2>Documents</h2>
                <span>{filteredDocuments.length} visible</span>
              </div>
              <div className={styles.listScroll}>
                {filteredDocuments.map((document) => (
                  <button
                    key={document.slug}
                    type="button"
                    className={document.slug === selectedDocument?.slug ? styles.selectedDocument : styles.documentButton}
                    onClick={() => chooseDocument(document.slug)}
                  >
                    <span className={styles.documentTitle}>{document.title}</span>
                    <span className={styles.documentPath}>{document.path}</span>
                    <span className={`${styles.badge} ${sensitivityClass(document.sensitivity)}`}>{document.sensitivity}</span>
                  </button>
                ))}
                {filteredDocuments.length === 0 ? <p className={styles.empty}>No visible documents match this query.</p> : null}
              </div>
            </aside>

            <div className={styles.detail} aria-live="polite">
          {selectedDocument && activeTab === "documents" ? (
            <article className={styles.documentDetail}>
              <div className={styles.panelHead}>
                <div>
                  <h2>{selectedDocument.title}</h2>
                  <p>{selectedDocument.path}</p>
                </div>
                <span className={`${styles.badge} ${sensitivityClass(selectedDocument.sensitivity)}`}>{selectedDocument.sensitivity}</span>
              </div>
              <div className={styles.metaRow}>
                <span>rev {selectedDocument.revisionNumber}</span>
                <span>{formatTime(selectedDocument.updatedAt)}</span>
                <span>{selectedDocument.tags.join(" / ")}</span>
              </div>
              <p className={styles.summaryText}>{selectedDocument.summary}</p>
              <pre className={styles.markdown}>{selectedDocument.bodyMd}</pre>
            </article>
          ) : null}

          {selectedDocument && activeTab === "map" ? (
            <section className={styles.mapView} aria-label="Semantic context">
              <div className={styles.panelHead}>
                <div>
                  <h2>Semantic Context</h2>
                  <p>{selectedDocument.title}</p>
                </div>
                {hiddenLinkCount > 0 ? <span className={styles.hiddenCount}>{hiddenLinkCount} hidden</span> : null}
              </div>
              <div className={styles.mapGrid}>
                <section>
                  <h3>Links</h3>
                  {selectedLinks.map((link) => (
                    <button key={link.id} type="button" className={styles.linkRow} onClick={() => chooseDocument(link.neighbor.slug)}>
                      <span>{link.direction}</span>
                      <strong>{link.neighbor.title}</strong>
                      <em>{link.linkType} · {Math.round(link.confidence * 100)}%</em>
                      <small>{link.evidence}</small>
                    </button>
                  ))}
                  {selectedLinks.length === 0 ? <p className={styles.empty}>No readable neighbors for this role.</p> : null}
                </section>

                <section>
                  <h3>Concepts</h3>
                  {selectedConcepts.map((concept) => (
                    <div key={concept.id} className={styles.conceptRow}>
                      <strong>{concept.name}</strong>
                      <span>{Math.round(concept.confidence * 100)}%</span>
                      <p>{concept.description}</p>
                      <small>{concept.documents.map((document) => document.title).join(" / ")}</small>
                    </div>
                  ))}
                </section>

                <section className={styles.chunkSection}>
                  <h3>Chunks</h3>
                  {selectedChunks.map((chunk) => (
                    <blockquote key={chunk.id}>
                      <span>chunk {chunk.chunkIndex} · {chunk.tokenCount} tokens</span>
                      <p>{chunk.bodyMd}</p>
                    </blockquote>
                  ))}
                </section>
              </div>
            </section>
          ) : null}

          {selectedDocument && activeTab === "write" ? (
            <section className={styles.writeView} aria-label="Write operations">
              <div className={styles.panelHead}>
                <div>
                  <h2>Write</h2>
                  <p>{activeRole.capabilities.canUpdateDocs ? "proposal and create paths are enabled" : "current role has read-only capabilities"}</p>
                </div>
              </div>
              <div className={styles.writeGrid}>
                <form className={styles.formPanel} onSubmit={submitProposal}>
                  <h3>Propose Revision</h3>
                  <label className={styles.field}>
                    <span>target</span>
                    <input readOnly value={selectedDocument.slug} />
                  </label>
                  <label className={styles.field}>
                    <span>summary</span>
                    <input value={proposalSummary} onChange={(event) => setProposalSummary(event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>body</span>
                    <textarea value={proposalBody} onChange={(event) => setProposalBody(event.target.value)} rows={7} />
                  </label>
                  <button type="submit" disabled={!activeRole.capabilities.canUpdateDocs || !proposalBody.trim()}>
                    create proposal
                  </button>
                </form>

                <form className={styles.formPanel} onSubmit={createLocalDocument}>
                  <h3>Create Document</h3>
                  <label className={styles.field}>
                    <span>title</span>
                    <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>sensitivity</span>
                    <select
                      value={newSensitivity}
                      onChange={(event) => setNewSensitivity(event.target.value as SensitivityLabel)}
                    >
                      <option value="public">public</option>
                      <option value="internal">internal</option>
                      <option value="restricted">restricted</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>body</span>
                    <textarea value={newBody} onChange={(event) => setNewBody(event.target.value)} rows={7} />
                  </label>
                  <button
                    type="submit"
                    disabled={
                      !activeRole.capabilities.canCreateDocs ||
                      !activeRole.allowedLabels.includes(newSensitivity) ||
                      !newTitle.trim() ||
                      !newBody.trim()
                    }
                  >
                    create local doc
                  </button>
                </form>
              </div>

              {proposals.length > 0 ? (
                <section className={styles.proposalList} aria-label="Pending proposals">
                  <h3>Pending proposals</h3>
                  {proposals.map((proposal) => (
                    <article key={proposal.id}>
                      <strong>{proposal.documentSlug}</strong>
                      <span>{formatTime(proposal.createdAt)}</span>
                      <p>{proposal.summary}</p>
                    </article>
                  ))}
                </section>
              ) : null}
            </section>
          ) : null}

          {activeTab === "audit" ? (
            <section className={styles.auditView} aria-label="Audit events">
              <div className={styles.panelHead}>
                <div>
                  <h2>Audit</h2>
                  <p>{activeRole.capabilities.canReadAudit ? "admin view" : "403 for this role"}</p>
                </div>
              </div>
              {activeRole.capabilities.canReadAudit ? (
                <div className={styles.auditRows}>
                  {auditEvents.map((event) => (
                    <article key={event.id}>
                      <span>{formatTime(event.createdAt)}</span>
                      <strong>{event.action}</strong>
                      <em>{event.actor}</em>
                      <p>{event.resourceType}:{event.resourceSlug}</p>
                      <small>{metadataText(event.metadata)}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.forbidden}>
                  <strong>forbidden</strong>
                  <p>Switch to the admin key to inspect audit_events.</p>
                </div>
              )}
            </section>
          ) : null}

          {activeTab === "vault" ? <VaultGraphTab /> : null}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
