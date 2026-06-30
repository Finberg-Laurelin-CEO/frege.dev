"use client";

import type { CSSProperties } from "react";
import { DEMO_ROLES } from "@/lib/prototype/demo-data";
import { CONSOLE_TRUST_ZONES, roleCaps } from "@/lib/prototype/console-demo";
import type { SensitivityLabel } from "@/lib/prototype/types";
import { panel, sectionHeading } from "./ui";

const DEMO_MEMBERS = [
  { email: "you@acme.co", name: "You", role: "owner" },
  { email: "sam@acme.co", name: "Sam Ortega", role: "admin" },
  { email: "dev@acme.co", name: "Dev Patel", role: "member" },
  { email: "ops@acme.co", name: "Robin Ng", role: "viewer" },
];

function cell(allow: boolean, sens?: SensitivityLabel): { mark: string; style: CSSProperties } {
  const bg = !allow
    ? "var(--surface)"
    : sens === "restricted"
      ? "var(--restricted-bg)"
      : sens === "internal"
        ? "var(--internal-bg)"
        : sens === "public"
          ? "var(--public-bg)"
          : "var(--green-tint)";
  return {
    mark: allow ? "✓" : "·",
    style: { background: bg, padding: "11px 6px", textAlign: "center", fontSize: 13, color: allow ? "var(--green-dark)" : "var(--faint)" },
  };
}

function zoneBorder(sens: SensitivityLabel): string {
  if (sens === "restricted") return "var(--restricted-bd)";
  if (sens === "internal") return "var(--internal-bd)";
  return "var(--public-bd)";
}
function zoneBg(sens: SensitivityLabel): string {
  if (sens === "restricted") return "var(--restricted-bg)";
  if (sens === "internal") return "var(--internal-bg)";
  return "var(--public-bg)";
}

const COLS = ["public", "internal", "restricted", "audit", "propose", "review", "run"];

const headCell: CSSProperties = { background: "var(--surface)", padding: "11px 6px", fontSize: 10.5, color: "var(--muted)", textAlign: "center" };

export default function AccessSection({ roleSlug, actingAsName }: { roleSlug: string; actingAsName: string }) {
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h2 style={sectionHeading}>who can read what</h2>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>trust-zone × capability matrix</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(7, 1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line-strong)" }}>
          <div style={{ background: "var(--surface)", padding: "11px 12px", fontSize: 11, color: "var(--muted)" }}>role</div>
          {COLS.map((c) => (
            <div key={c} style={headCell}>
              {c}
            </div>
          ))}
          {DEMO_ROLES.map((role) => {
            const isCur = role.slug === roleSlug;
            const caps = roleCaps(role.capabilities);
            const cells = [
              cell(role.allowedLabels.includes("public"), "public"),
              cell(role.allowedLabels.includes("internal"), "internal"),
              cell(role.allowedLabels.includes("restricted"), "restricted"),
              cell(caps.audit),
              cell(caps.propose),
              cell(caps.review),
              cell(caps.run),
            ];
            return (
              <div key={role.slug} style={{ display: "contents" }}>
                <div
                  style={{
                    background: isCur ? "var(--green-tint)" : "var(--surface)",
                    padding: "11px 12px",
                    borderLeft: `2px solid ${isCur ? "var(--green)" : "transparent"}`,
                  }}
                >
                  <div style={{ fontSize: 13, color: "var(--ink)" }}>{role.name}</div>
                  <div style={{ fontSize: 11, color: "var(--faint)" }}>{role.keyPrefix}</div>
                </div>
                {cells.map((cc, i) => (
                  <div key={i} style={cc.style}>
                    {cc.mark}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--faint)" }}>
          ◆ = current role (viewing as {actingAsName}). Cells show what each key can reach before any request is made.
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        <section style={{ ...panel, padding: 18 }}>
          <h2 style={{ ...sectionHeading, marginBottom: 12 }}>trust zones</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {CONSOLE_TRUST_ZONES.map((z) => (
              <div key={z.name} style={{ border: `1px solid ${zoneBorder(z.sens)}`, background: zoneBg(z.sens), padding: "11px 13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, color: "var(--ink)" }}>{z.name}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{z.tag}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.5 }}>{z.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ ...panel, padding: 18 }}>
          <h2 style={{ ...sectionHeading, marginBottom: 12 }}>members</h2>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {DEMO_MEMBERS.map((m) => (
              <div
                key={m.email}
                style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)" }}
              >
                <div>
                  <div style={{ fontSize: 13, color: "var(--ink)" }}>{m.email}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{m.name}</div>
                </div>
                <span style={{ fontSize: 11, color: "var(--green-dark)", border: "1px solid var(--line-strong)", padding: "2px 8px" }}>{m.role}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
