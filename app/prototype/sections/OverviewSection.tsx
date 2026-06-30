"use client";

import { useEffect, useState } from "react";
import {
  type RealAgent,
  type RealEvent,
  type RealSummary,
  eventActor,
  eventStatus,
  eventSummary,
  formatCost,
  formatEventTime,
  formatLatency,
  getJson,
} from "./realdata";
import { type ConsoleSection, panel, sectionHeading, statusColor, statusLabel } from "./ui";

export default function OverviewSection({
  orgSlug,
  onNavigate,
  onOpenEvent,
  onInspectDenied,
}: {
  orgSlug: string;
  onNavigate: (section: ConsoleSection) => void;
  onOpenEvent: (id: string) => void;
  onInspectDenied: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<RealSummary | null>(null);
  const [events, setEvents] = useState<RealEvent[]>([]);
  const [agents, setAgents] = useState<RealAgent[]>([]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    if (!orgSlug) {
      setLoading(false);
      return;
    }
    const q = `org_slug=${encodeURIComponent(orgSlug)}`;
    Promise.all([
      getJson<{ summary: RealSummary }>(`/api/v1/admin/telemetry?${q}`),
      getJson<{ events: RealEvent[] }>(`/api/v1/admin/audit-events?${q}&limit=8`),
      getJson<{ agents: RealAgent[] }>(`/api/v1/admin/agents?${q}`),
    ]).then(([tel, audit, ag]) => {
      if (!live) return;
      setSummary(tel.data?.summary ?? null);
      setEvents(audit.data?.events ?? []);
      setAgents(ag.data?.agents ?? []);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [orgSlug]);

  const deniedReads = summary?.denied_events ?? 0;

  const metrics: { value: string; label: string }[] = [
    { value: String(summary?.context_builds ?? 0), label: "context builds" },
    { value: String(summary?.model_calls ?? 0), label: "model calls" },
    { value: String(deniedReads), label: "denied reads" },
    { value: String(summary?.total_events ?? 0), label: "total events" },
    { value: formatCost(summary?.estimated_cost_usd), label: "est. cost" },
    { value: formatLatency(summary?.avg_latency_ms), label: "avg latency" },
  ];

  const recent = events.slice(0, 6);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      {deniedReads > 0 ? (
        <div style={{ border: "1px solid var(--internal-bd)", background: "var(--internal-bg)", padding: "14px 16px" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink-2)", marginBottom: 8 }}>
            ▸ needs attention
          </div>
          <button
            type="button"
            onClick={onInspectDenied}
            style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", textAlign: "left", width: "100%" }}
          >
            <span style={{ fontSize: 13, color: "var(--ink)" }}>
              {deniedReads} access {deniedReads === 1 ? "attempt was" : "attempts were"} blocked in this period
            </span>
            <span style={{ fontSize: 12, color: "var(--green)", whiteSpace: "nowrap" }}>inspect →</span>
          </button>
        </div>
      ) : null}

      <div>
        <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>
          recent activity
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
          {metrics.map((m) => (
            <div key={m.label} style={{ ...panel, padding: "14px 14px", minHeight: 70 }}>
              <div style={{ fontSize: 22, color: "var(--ink)", letterSpacing: "-0.01em" }}>{loading ? "–" : m.value}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18, alignItems: "start" }}>
        <section style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "16px 18px 12px" }}>
            <h2 style={sectionHeading}>recent events</h2>
            <button type="button" onClick={() => onNavigate("activity")} style={{ fontSize: 12, color: "var(--green)" }}>
              view all →
            </button>
          </div>
          {loading ? (
            <p style={{ padding: "0 18px 16px", fontSize: 12, color: "var(--muted)" }}>Loading activity…</p>
          ) : recent.length === 0 ? (
            <div style={{ padding: "4px 18px 18px" }}>
              <p style={{ fontSize: 13, color: "var(--ink)", margin: 0 }}>No activity yet.</p>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
                Connect an agent in{" "}
                <button type="button" onClick={() => onNavigate("connect")} style={{ color: "var(--green)" }}>
                  connect
                </button>{" "}
                and its queries, context builds, and denied reads appear here.
              </p>
            </div>
          ) : (
            recent.map((ev) => {
              const status = eventStatus(ev);
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onOpenEvent(ev.id)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "11px 18px", borderTop: "1px solid var(--line)" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <span style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.4 }}>{eventSummary(ev)}</span>
                    <span style={{ fontSize: 11, color: statusColor(status), whiteSpace: "nowrap" }}>{statusLabel(status)}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
                    {formatEventTime(ev.created_at)} · {eventActor(ev)}
                  </div>
                </button>
              );
            })
          )}
        </section>

        <section style={{ ...panel, padding: 18 }}>
          <h2 style={{ ...sectionHeading, marginBottom: 12 }}>agents</h2>
          {loading ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Loading…</p>
          ) : agents.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>No hosted agents yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {agents.map((ag) => (
                <div
                  key={ag.slug}
                  style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--ink)" }}>
                      <span style={{ color: ag.status === "active" ? "var(--green)" : "var(--faint)" }}>●</span> {ag.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {(ag.model_name ?? ag.model_config_slug ?? "model") + (ag.trust_zone ? ` · ${ag.trust_zone} zone` : "")}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap" }}>{ag.status ?? ""}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
