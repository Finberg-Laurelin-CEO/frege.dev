"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../admin/admin.module.css";

// Customer-facing support surface: org owners/admins raise tickets, follow the
// thread, and reply. Staff handle the other side from /platform (tickets tab).

type Membership = {
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: string;
  role: string;
  status: string;
};

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

type TicketDetail = {
  ticket: TicketRow;
  messages: {
    id: string;
    author_kind: "customer" | "staff";
    body: string;
    created_at: string;
    author_email: string | null;
    author_name: string | null;
  }[];
};

function shortDay(value: string): string {
  return String(value).slice(0, 10);
}

function statusBadgeClass(status: string): string {
  if (status === "open") return styles.badgeWarn;
  if (status === "pending") return styles.badgeOk;
  if (status === "resolved") return styles.badgeOk;
  if (status === "closed") return styles.badgeMuted;
  return "";
}

function statusHint(status: string): string {
  if (status === "open") return "waiting on Frege";
  if (status === "pending") return "waiting on you";
  return status;
}

export default function SupportConsole({
  userEmail,
  memberships,
}: {
  userEmail: string;
  memberships: Membership[];
}) {
  const activeOrg = memberships.find((m) => m.status === "active") ?? memberships[0];
  const orgSlug = activeOrg?.org_slug ?? "";
  const canManage = activeOrg?.role === "owner" || activeOrg?.role === "admin";

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [created, setCreated] = useState(false);

  const apiPath = useCallback(
    (path: string) => `${path}?org_slug=${encodeURIComponent(orgSlug)}`,
    [orgSlug],
  );

  const loadTickets = useCallback(async () => {
    if (!orgSlug || !canManage) return;
    try {
      const res = await fetch(apiPath("/api/v1/support/tickets"));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`Failed to load tickets (${res.status}).`);
        return;
      }
      setTickets((json as { tickets?: TicketRow[] }).tickets ?? []);
    } catch {
      setError("Failed to load tickets.");
    }
  }, [orgSlug, canManage, apiPath]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const openTicket = useCallback(
    async (ticketId: string) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch(apiPath(`/api/v1/support/tickets/${ticketId}`));
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(`Failed to load ticket (${res.status}).`);
          return;
        }
        setDetail(json as TicketDetail);
        setReply("");
      } catch {
        setError("Failed to load ticket.");
      } finally {
        setBusy(false);
      }
    },
    [apiPath],
  );

  async function createTicket() {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody) {
      setError("Add a subject and a description before sending.");
      return;
    }
    setBusy(true);
    setError("");
    setCreated(false);
    try {
      const res = await fetch(apiPath("/api/v1/support/tickets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: trimmedSubject, body: trimmedBody }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`Could not create the ticket (${json.error ?? res.status}).`);
        return;
      }
      setSubject("");
      setBody("");
      setCreated(true);
      await loadTickets();
      const ticketId = (json as { ticket?: { id?: string } }).ticket?.id;
      if (ticketId) await openTicket(ticketId);
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(ticketId: string) {
    const trimmed = reply.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiPath(`/api/v1/support/tickets/${ticketId}/messages`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          json.error === "ticket_closed"
            ? "This ticket is closed. Open a new one if you still need help."
            : `Reply failed (${json.error ?? res.status}).`,
        );
        return;
      }
      setReply("");
      await openTicket(ticketId);
      await loadTickets();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Support</h1>
          <p className={styles.meta}>
            {activeOrg ? `${activeOrg.org_name} (${activeOrg.org_slug})` : "No organization"} · {userEmail}
          </p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.buttonSecondary} href="/console">back to console</a>
        </div>
      </header>

      <section className={styles.panel}>
        {error ? <p className={styles.notice}>{error}</p> : null}

        {!activeOrg ? (
          <div className={styles.empty}>
            <strong>No organization found.</strong>
            <span>Join an organization before raising a support ticket.</span>
          </div>
        ) : !canManage ? (
          <div className={styles.empty}>
            <strong>Support tickets are managed by org owners and admins.</strong>
            <span>Ask an owner or admin of {activeOrg.org_name} to raise the request.</span>
          </div>
        ) : (
          <>
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Open a ticket</h2>
              <p className={styles.sectionLead} style={{ marginTop: 0 }}>
                Tell us what&apos;s wrong and we&apos;ll reply here and by email ({userEmail}).
              </p>
              {created ? (
                <div className={styles.notice}>
                  <strong>Ticket created.</strong>
                  <span>The Frege team has been notified and will reply here.</span>
                </div>
              ) : null}
              <label className={styles.label} htmlFor="support-subject">Subject</label>
              <input
                id="support-subject"
                className={styles.input}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Short summary of the issue"
                maxLength={200}
              />
              <label className={styles.label} htmlFor="support-body">What happened?</label>
              <textarea
                id="support-body"
                className={styles.textarea}
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What did you expect, what happened instead, and any error messages."
              />
              <div className={styles.buttonRow}>
                <button type="button" className={styles.button} disabled={busy || !subject.trim() || !body.trim()} onClick={createTicket}>
                  send to support
                </button>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Your tickets ({tickets.length})</h2>
              {tickets.length === 0 ? (
                <div className={styles.empty}>
                  <strong>No tickets yet.</strong>
                  <span>Tickets you raise for {activeOrg.org_name} show up here.</span>
                </div>
              ) : (
                <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>subject</th><th>status</th><th>messages</th><th>updated</th></tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <button type="button" className={styles.linkButton} onClick={() => openTicket(t.id)}>{t.subject}</button>
                        </td>
                        <td>
                          <span className={`${styles.badge} ${statusBadgeClass(t.status)}`}>{t.status}</span>
                          <span className={styles.summaryHint}>{statusHint(t.status)}</span>
                        </td>
                        <td>{t.message_count}</td>
                        <td>{shortDay(t.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}

              {busy && !detail ? <p className={styles.status}>Loading…</p> : null}

              {detail ? (
                <div className={styles.detail}>
                  <div className={styles.detailHeader}>
                    <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
                      {detail.ticket.subject}{" "}
                      <span className={`${styles.badge} ${statusBadgeClass(detail.ticket.status)}`}>{detail.ticket.status}</span>
                    </h3>
                    <button type="button" className={styles.buttonSecondary} onClick={() => setDetail(null)} aria-label="Close ticket">close</button>
                  </div>

                  <div className={styles.detailSection}>
                    {detail.messages.map((m) => (
                      <div key={m.id} style={{ marginBottom: 12 }}>
                        <p className={styles.summaryHint} style={{ margin: 0 }}>
                          <span className={`${styles.badge} ${m.author_kind === "staff" ? styles.badgeOk : ""}`}>
                            {m.author_kind === "staff" ? "Frege team" : m.author_email ?? "you"}
                          </span>{" "}
                          {shortDay(m.created_at)}
                        </p>
                        <p className={styles.sectionLead} style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{m.body}</p>
                      </div>
                    ))}
                  </div>

                  {detail.ticket.status === "closed" ? (
                    <p className={styles.status}>This ticket is closed. Open a new one if you still need help.</p>
                  ) : (
                    <div className={styles.detailSection}>
                      <label className={styles.label} htmlFor="support-reply">Reply</label>
                      <textarea
                        id="support-reply"
                        className={styles.textarea}
                        rows={4}
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        placeholder="Add more detail or answer the team's questions."
                      />
                      <div className={styles.buttonRow}>
                        <button type="button" className={styles.button} disabled={busy || !reply.trim()} onClick={() => sendReply(detail.ticket.id)}>
                          send reply
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
