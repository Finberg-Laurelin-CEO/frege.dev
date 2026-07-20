"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { CONSOLE_TRUST_ZONES } from "@/lib/core/console-demo";
import type { SensitivityLabel } from "@/lib/core/types";
import { getJson } from "./realdata";
import { panel, sectionHeading } from "./ui";

type RealRole = {
  id: string;
  slug: string;
  name: string;
  can_read_labels: string[];
  can_read_audit?: boolean;
  can_update_docs?: boolean;
  can_propose_memory?: boolean;
  can_review_memory_proposals?: boolean;
};

type RealMember = { id: string; email: string; name: string | null; role: string; status: string };

const COLS = ["public", "internal", "restricted", "audit", "propose", "review"];
const headCell: CSSProperties = { background: "var(--surface)", padding: "11px 6px", fontSize: 10.5, color: "var(--muted)", textAlign: "center" };

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

export default function AccessSection({ orgSlug }: { orgSlug: string }) {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [roles, setRoles] = useState<RealRole[]>([]);
  const [members, setMembers] = useState<RealMember[]>([]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setForbidden(false);
    if (!orgSlug) {
      setLoading(false);
      return;
    }
    const q = `org_slug=${encodeURIComponent(orgSlug)}`;
    Promise.all([
      getJson<{ roles: RealRole[] }>(`/api/v1/admin/roles?${q}`),
      getJson<{ members: RealMember[] }>(`/api/v1/admin/members?${q}`),
    ]).then(([r, m]) => {
      if (!live) return;
      if (r.forbidden || m.forbidden) setForbidden(true);
      setRoles(r.data?.roles ?? []);
      setMembers(m.data?.members ?? []);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [orgSlug]);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h2 style={sectionHeading}>who can read what</h2>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>trust-zone × capability matrix</span>
        </div>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Loading roles…</p>
        ) : forbidden ? (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>The capability matrix and members list require an admin role for this org.</p>
        ) : roles.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>No roles configured yet. Roles you create in connect appear here with their read scope and capabilities.</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(6, 1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line-strong)" }}>
              <div style={{ background: "var(--surface)", padding: "11px 12px", fontSize: 11, color: "var(--muted)" }}>role</div>
              {COLS.map((c) => (
                <div key={c} style={headCell}>
                  {c}
                </div>
              ))}
              {roles.map((role) => {
                const labels = role.can_read_labels ?? [];
                const cells = [
                  cell(labels.includes("public"), "public"),
                  cell(labels.includes("internal"), "internal"),
                  cell(labels.includes("restricted"), "restricted"),
                  cell(Boolean(role.can_read_audit)),
                  cell(Boolean(role.can_propose_memory || role.can_update_docs)),
                  cell(Boolean(role.can_review_memory_proposals)),
                ];
                return (
                  <div key={role.slug} style={{ display: "contents" }}>
                    <div style={{ background: "var(--surface)", padding: "11px 12px" }}>
                      <div style={{ fontSize: 13, color: "var(--ink)" }}>{role.name}</div>
                      <div style={{ fontSize: 11, color: "var(--faint)" }}>{role.slug}</div>
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
              Cells show what each role&apos;s keys can reach before any request is made.
            </div>
          </>
        )}
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
          {loading ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Loading…</p>
          ) : forbidden ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Requires an admin role.</p>
          ) : members.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>No members yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {members.map((m) => (
                <div
                  key={m.id}
                  style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--ink)" }}>{m.email}</div>
                    {m.name ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{m.name}</div> : null}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--green-dark)", border: "1px solid var(--line-strong)", padding: "2px 8px" }}>{m.role}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
