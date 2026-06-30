"use client";

import { DEMO_DOCUMENTS } from "@/lib/prototype/demo-data";
import { CONSOLE_AGENTS, CONSOLE_EVENTS, CONSOLE_SPARK } from "@/lib/prototype/console-demo";
import type { SensitivityLabel } from "@/lib/prototype/types";
import { type ConsoleSection, panel, sectionHeading, statusColor, statusLabel } from "./ui";

const SENS_ORDER: SensitivityLabel[] = ["public", "internal", "restricted"];

function sensBorder(sens: SensitivityLabel): string {
  if (sens === "restricted") return "var(--restricted-bd)";
  if (sens === "internal") return "var(--internal-bd)";
  return "var(--public-bd)";
}

export default function OverviewSection({
  onNavigate,
  onOpenEvent,
  onReviewDoc,
  onInspectDenied,
}: {
  onNavigate: (section: ConsoleSection) => void;
  onOpenEvent: (id: string) => void;
  onReviewDoc: (slug: string) => void;
  onInspectDenied: () => void;
}) {
  const deniedToday = CONSOLE_EVENTS.filter((e) => e.status === "denied").length;

  const metrics: { value: string; label: string }[] = [
    { value: "38", label: "context builds" },
    { value: "24", label: "model calls" },
    { value: String(deniedToday), label: "denied reads" },
    { value: "1", label: "pending proposals" },
    { value: "$0.42", label: "est. cost" },
    { value: "1.6s", label: "avg latency" },
  ];

  const peak = Math.max(...CONSOLE_SPARK);
  const recent = CONSOLE_EVENTS.slice(0, 5);

  const sensCounts: Record<SensitivityLabel, number> = { public: 0, internal: 0, restricted: 0 };
  for (const doc of DEMO_DOCUMENTS) sensCounts[doc.sensitivity] += 1;
  const maxSens = Math.max(...SENS_ORDER.map((s) => sensCounts[s]));

  const attention = [
    {
      text: "1 write proposal awaiting review on customer-refunds",
      cta: "review",
      onClick: () => onReviewDoc("customer-refunds"),
    },
    { text: "frg_writer_c3a1 expires in 12 days", cta: "rotate", onClick: () => onNavigate("connect") },
    { text: `${deniedToday} access attempts were blocked in the last 24h`, cta: "inspect", onClick: onInspectDenied },
  ];

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ border: "1px solid var(--internal-bd)", background: "var(--internal-bg)", padding: "14px 16px" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink-2)", marginBottom: 8 }}>
          ▸ needs attention
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {attention.map((a) => (
            <button
              key={a.text}
              type="button"
              onClick={a.onClick}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "baseline",
                textAlign: "left",
                width: "100%",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--ink)" }}>{a.text}</span>
              <span style={{ fontSize: 12, color: "var(--green)", whiteSpace: "nowrap" }}>{a.cta} →</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>
          last 24 hours
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
          {metrics.map((m) => (
            <div key={m.label} style={{ ...panel, padding: "14px 14px", minHeight: 70 }}>
              <div style={{ fontSize: 22, color: "var(--ink)", letterSpacing: "-0.01em" }}>{m.value}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section style={{ ...panel, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
              <h2 style={sectionHeading}>agent calls · hourly</h2>
              <span style={{ fontSize: 11, color: "var(--faint)" }}>{peak} calls peak</span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 84 }}>
              {CONSOLE_SPARK.map((v, i) => (
                <div
                  key={i}
                  title={`${i}:00 · ${v} calls`}
                  style={{
                    flex: 1,
                    height: Math.max(6, Math.round((v / peak) * 84)),
                    background: v >= peak - 1 ? "var(--green)" : "var(--green-dark)",
                    opacity: v >= peak - 1 ? 1 : 0.45,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--faint)" }}>
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>now</span>
            </div>
          </section>

          <section style={panel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "16px 18px 12px" }}>
              <h2 style={sectionHeading}>recent events</h2>
              <button type="button" onClick={() => onNavigate("activity")} style={{ fontSize: 12, color: "var(--green)" }}>
                view all →
              </button>
            </div>
            {recent.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => onOpenEvent(ev.id)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "11px 18px", borderTop: "1px solid var(--line)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.4 }}>{ev.summary}</span>
                  <span style={{ fontSize: 11, color: statusColor(ev.status), whiteSpace: "nowrap" }}>{statusLabel(ev.status)}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
                  {ev.time} · {ev.actor}
                </div>
              </button>
            ))}
          </section>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section style={{ ...panel, padding: 18 }}>
            <h2 style={{ ...sectionHeading, marginBottom: 12 }}>agents</h2>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {CONSOLE_AGENTS.map((ag) => (
                <div
                  key={ag.name}
                  style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--ink)" }}>
                      <span style={{ color: "var(--green)" }}>●</span> {ag.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {ag.model} · {ag.zone}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap" }}>{ag.lastRun}</span>
                </div>
              ))}
            </div>
          </section>

          <section style={{ ...panel, padding: 18 }}>
            <h2 style={{ ...sectionHeading, marginBottom: 12 }}>knowledge by sensitivity</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {SENS_ORDER.map((s) => (
                <div key={s}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                    <span style={{ color: "var(--ink)" }}>{s}</span>
                    <span style={{ color: "var(--muted)" }}>{sensCounts[s]} docs</span>
                  </div>
                  <div style={{ height: 7, background: "var(--paper-deep)", border: "1px solid var(--line)" }}>
                    <div style={{ height: "100%", width: `${Math.round((sensCounts[s] / maxSens) * 100)}%`, background: sensBorder(s) }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
