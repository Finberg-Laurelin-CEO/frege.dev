"use client";

// Shared visual primitives for the redesigned console's presentation
// sections. Inline styles reference the global design tokens defined in
// public/styles.css so these stay in lockstep with the paper-and-green system.

import type { CSSProperties, ReactNode } from "react";
import type { SensitivityLabel } from "@/lib/prototype/types";

export type ConsoleSection = "overview" | "activity" | "knowledge" | "access" | "connect" | "billing";

export const panel: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line-strong)",
};

export const sectionHeading: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 400,
  letterSpacing: "0.03em",
  color: "var(--ink)",
};

export const eyebrow: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--green)",
};

export function toneVars(sens: SensitivityLabel): { bd: string; bg: string } {
  if (sens === "restricted") return { bd: "var(--restricted-bd)", bg: "var(--restricted-bg)" };
  if (sens === "internal") return { bd: "var(--internal-bd)", bg: "var(--internal-bg)" };
  return { bd: "var(--public-bd)", bg: "var(--public-bg)" };
}

export function Badge({ tone, children }: { tone: SensitivityLabel; children: ReactNode }) {
  const { bd, bg } = toneVars(tone);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 11,
        color: "var(--green-dark)",
        border: `1px solid ${bd}`,
        background: bg,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export type StatusKind = "ok" | "denied" | "pending";

export function statusLabel(status: StatusKind): string {
  if (status === "denied") return "✕ blocked";
  if (status === "pending") return "◆ pending";
  return "● ok";
}

export function statusColor(status: StatusKind): string {
  if (status === "denied") return "var(--restricted-ink)";
  if (status === "pending") return "#8a6d1f";
  return "var(--green)";
}

export function statusBadgeStyle(status: StatusKind): CSSProperties {
  const map: Record<StatusKind, [string, string, string]> = {
    denied: ["var(--restricted-ink)", "var(--restricted-bd)", "var(--restricted-bg)"],
    pending: ["#8a6d1f", "var(--internal-bd)", "var(--internal-bg)"],
    ok: ["var(--green-dark)", "var(--public-bd)", "var(--public-bg)"],
  };
  const [color, bd, bg] = map[status];
  return { fontSize: 11, color, border: `1px solid ${bd}`, background: bg, padding: "3px 9px", whiteSpace: "nowrap" };
}

// A bare card section with a heading row.
export function CardSection({
  title,
  aside,
  children,
  bodyPad = 18,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  bodyPad?: number;
}) {
  return (
    <section style={panel}>
      {title ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "16px 18px 12px",
          }}
        >
          <h2 style={sectionHeading}>{title}</h2>
          {aside}
        </div>
      ) : null}
      <div style={{ padding: title ? `0 ${bodyPad}px ${bodyPad}px` : bodyPad }}>{children}</div>
    </section>
  );
}
