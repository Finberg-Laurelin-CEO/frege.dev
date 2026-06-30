"use client";

import { CONSOLE_EVENTS, type ActivityEvent, type ActivityGroup } from "@/lib/prototype/console-demo";
import { Badge, eyebrow, panel, statusBadgeStyle, statusColor, statusLabel } from "./ui";

const FILTERS: { key: "all" | ActivityGroup | "denied"; label: string }[] = [
  { key: "all", label: "all" },
  { key: "runs", label: "agent runs" },
  { key: "denied", label: "denied & blocked" },
  { key: "writes", label: "proposals" },
];

function matchesFilter(ev: ActivityEvent, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "denied") return ev.group === "denied" || ev.status === "denied";
  return ev.group === filter;
}

function tokenBar(tokens: number, color: string) {
  return <div style={{ height: "100%", width: `${Math.min(100, Math.round((tokens / 2000) * 100))}%`, background: color }} />;
}

export default function ActivitySection({
  selectedId,
  onSelect,
  filter,
  onFilter,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  filter: string;
  onFilter: (key: string) => void;
}) {
  const events = CONSOLE_EVENTS.filter((e) => matchesFilter(e, filter));
  const sel = CONSOLE_EVENTS.find((e) => e.id === selectedId) ?? CONSOLE_EVENTS[0];
  const hasBuild = sel.retrieved.length > 0 || sel.denied.length > 0;
  const buildSummary = `${sel.retrieved.length} included${sel.denied.length ? `, ${sel.denied.length} denied` : ""}`;

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
            <span style={{ fontSize: 11, color: "var(--faint)" }}>{events.length} events</span>
          </div>
          <div className="frgscroll" style={{ maxHeight: 620, overflowY: "auto" }}>
            {events.map((ev) => {
              const active = ev.id === selectedId;
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
                    <span style={{ fontSize: 11, color: "var(--faint)" }}>{ev.time}</span>
                    <span style={{ fontSize: 11, color: statusColor(ev.status), whiteSpace: "nowrap" }}>{statusLabel(ev.status)}</span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 13, color: "var(--ink)", lineHeight: 1.45 }}>{ev.summary}</div>
                  <div style={{ marginTop: 5, fontSize: 11, color: "var(--muted)" }}>
                    {ev.actor} · {ev.action}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section style={{ ...panel, padding: "22px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, borderBottom: "1px solid var(--line)", paddingBottom: 14, marginBottom: 18 }}>
            <div>
              <div style={eyebrow}>
                <span style={{ color: "var(--faint)" }}>// </span>context trace
              </div>
              <h2 style={{ margin: "5px 0 0", fontSize: 17, fontWeight: 400, color: "var(--ink)" }}>{sel.summary}</h2>
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                {sel.actor} · {sel.time} · {sel.action}
              </div>
            </div>
            <span style={statusBadgeStyle(sel.status)}>{statusLabel(sel.status)}</span>
          </div>

          <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <div style={eyebrow}>▸ query</div>
              <div style={{ marginTop: 7, fontSize: 14, color: "var(--ink)", background: "var(--paper-deep)", border: "1px solid var(--line)", padding: "11px 13px" }}>
                {sel.query}
              </div>
            </div>

            {hasBuild ? (
              <div>
                <div style={eyebrow}>
                  ▸ context build <span style={{ color: "var(--faint)" }}>· {buildSummary}</span>
                </div>
                <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 7 }}>
                  {sel.retrieved.map((d) => (
                    <div
                      key={d.title}
                      style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "9px 11px", border: "1px solid var(--line)", background: "var(--surface-mute)" }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--ink)" }}>{d.title}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{d.detail}</div>
                      </div>
                      <Badge tone={d.sensitivity}>{d.sensitivity}</Badge>
                    </div>
                  ))}
                  {sel.denied.map((d) => (
                    <div
                      key={d.label}
                      style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "9px 11px", border: "1px solid var(--restricted-bd)", background: "var(--restricted-bg)" }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--ink)" }}>
                          <span style={{ color: "var(--restricted-ink)" }}>✗</span> {d.label}
                        </div>
                        <div style={{ fontSize: 11, color: "#8a4242", marginTop: 2 }}>{d.reason}</div>
                      </div>
                      <Badge tone="restricted">{d.sensitivity}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {sel.model ? (
              <div>
                <div style={eyebrow}>
                  ▸ model call <span style={{ color: "var(--faint)" }}>· {sel.model.name}</span>
                </div>
                <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ border: "1px solid var(--line)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>input · {sel.model.inTokens} tok</div>
                    <div style={{ height: 6, background: "var(--paper-deep)" }}>{tokenBar(sel.model.inTokens, "var(--green-dark)")}</div>
                  </div>
                  <div style={{ border: "1px solid var(--line)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>output · {sel.model.outTokens} tok</div>
                    <div style={{ height: 6, background: "var(--paper-deep)" }}>{tokenBar(sel.model.outTokens, "var(--green)")}</div>
                  </div>
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 18, fontSize: 12, color: "var(--muted)" }}>
                  <span>latency {sel.model.latency}</span>
                  <span>cost {sel.model.cost}</span>
                  <span>trust zone {sel.model.zone}</span>
                </div>
              </div>
            ) : null}

            {sel.answer ? (
              <div>
                <div style={eyebrow}>▸ answer returned</div>
                <div style={{ marginTop: 7, fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)", background: "var(--green-tint)", border: "1px solid var(--public-bd)", padding: "13px 15px" }}>
                  {sel.answer}
                </div>
              </div>
            ) : null}

            {sel.note ? <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55 }}>{sel.note}</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
