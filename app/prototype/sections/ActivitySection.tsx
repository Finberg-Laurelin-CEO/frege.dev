"use client";

import { useEffect, useState } from "react";
import {
  type EventGroup,
  type RealEvent,
  eventActor,
  eventGroup,
  eventStatus,
  eventSummary,
  formatEventTime,
  getJson,
  humanizeAction,
} from "./realdata";
import { eyebrow, panel, statusBadgeStyle, statusColor, statusLabel } from "./ui";

const FILTERS: { key: "all" | EventGroup; label: string }[] = [
  { key: "all", label: "all" },
  { key: "runs", label: "agent activity" },
  { key: "denied", label: "denied & blocked" },
  { key: "writes", label: "writes & proposals" },
];

function metadataEntries(metadata: Record<string, unknown>): [string, string][] {
  return Object.entries(metadata ?? {}).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]);
}

export default function ActivitySection({
  orgSlug,
  selectedId,
  onSelect,
  filter,
  onFilter,
}: {
  orgSlug: string;
  selectedId: string;
  onSelect: (id: string) => void;
  filter: string;
  onFilter: (key: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<RealEvent[]>([]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    if (!orgSlug) {
      setLoading(false);
      return;
    }
    getJson<{ events: RealEvent[] }>(`/api/v1/admin/audit-events?org_slug=${encodeURIComponent(orgSlug)}&limit=100`).then((res) => {
      if (!live) return;
      setEvents(res.data?.events ?? []);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [orgSlug]);

  const shown = events.filter((e) => filter === "all" || eventGroup(e) === filter);
  const sel = events.find((e) => e.id === selectedId) ?? shown[0] ?? events[0] ?? null;

  if (!loading && events.length === 0) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <section style={{ ...panel, padding: "28px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--ink)", margin: 0 }}>No activity in the audit ledger yet.</p>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0", lineHeight: 1.55 }}>
            Every query, context build, denied read, and reviewable write is recorded here once your agents start using the org&apos;s
            governed context. Admin-role keys can read this ledger.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilter(f.key)}
              style={{
                minHeight: 32,
                padding: "0 14px",
                fontSize: 12,
                border: `1px solid ${active ? "var(--green)" : "var(--line-strong)"}`,
                background: active ? "var(--green-tint)" : "var(--surface)",
                color: active ? "var(--green-dark)" : "var(--muted)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 18, alignItems: "start" }}>
        <section style={panel}>
          <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 400, letterSpacing: "0.04em", color: "var(--ink)" }}>event stream</h2>
            <span style={{ fontSize: 11, color: "var(--faint)" }}>{loading ? "…" : `${shown.length} events`}</span>
          </div>
          <div className="frgscroll" style={{ maxHeight: 620, overflowY: "auto" }}>
            {loading ? (
              <p style={{ padding: "14px 16px", fontSize: 12, color: "var(--muted)" }}>Loading…</p>
            ) : shown.length === 0 ? (
              <p style={{ padding: "14px 16px", fontSize: 12, color: "var(--muted)" }}>No events match this filter.</p>
            ) : (
              shown.map((ev) => {
                const active = ev.id === sel?.id;
                const status = eventStatus(ev);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onSelect(ev.id)}
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
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontSize: 11, color: "var(--faint)" }}>{formatEventTime(ev.created_at)}</span>
                      <span style={{ fontSize: 11, color: statusColor(status), whiteSpace: "nowrap" }}>{statusLabel(status)}</span>
                    </div>
                    <div style={{ marginTop: 5, fontSize: 13, color: "var(--ink)", lineHeight: 1.45 }}>{eventSummary(ev)}</div>
                    <div style={{ marginTop: 5, fontSize: 11, color: "var(--muted)" }}>
                      {eventActor(ev)} · {humanizeAction(ev.action)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section style={{ ...panel, padding: "22px 24px" }}>
          {sel ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, borderBottom: "1px solid var(--line)", paddingBottom: 14, marginBottom: 18 }}>
                <div>
                  <div style={eyebrow}>
                    <span style={{ color: "var(--faint)" }}>// </span>audit detail
                  </div>
                  <h2 style={{ margin: "5px 0 0", fontSize: 17, fontWeight: 400, color: "var(--ink)" }}>{eventSummary(sel)}</h2>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                    {eventActor(sel)} · {formatEventTime(sel.created_at)} · {humanizeAction(sel.action)}
                  </div>
                </div>
                <span style={statusBadgeStyle(eventStatus(sel))}>{statusLabel(eventStatus(sel))}</span>
              </div>

              <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 20 }}>
                <div>
                  <div style={eyebrow}>▸ resource</div>
                  <div style={{ marginTop: 7, fontSize: 14, color: "var(--ink)", background: "var(--paper-deep)", border: "1px solid var(--line)", padding: "11px 13px" }}>
                    {sel.resource_type ? `${sel.resource_type}${sel.resource_id ? ` · ${sel.resource_id}` : ""}` : "—"}
                  </div>
                </div>

                {metadataEntries(sel.metadata).length > 0 ? (
                  <div>
                    <div style={eyebrow}>▸ metadata</div>
                    <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 6 }}>
                      {metadataEntries(sel.metadata).map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, padding: "7px 11px", border: "1px solid var(--line)", background: "var(--surface-mute)" }}>
                          <span style={{ color: "var(--muted)" }}>{k}</span>
                          <span style={{ color: "var(--ink)", textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>No additional metadata recorded for this event.</p>
                )}
              </div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Select an event to see its audit detail.</p>
          )}
        </section>
      </div>
    </div>
  );
}
