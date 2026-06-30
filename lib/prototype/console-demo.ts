// Conceptual descriptions of Frege's three trust zones, shown on the Access
// section to explain the access model. These describe the product's sensitivity
// semantics — they are documentation, not per-user data.

import type { SensitivityLabel } from "./types";

export type TrustZone = { name: string; tag: string; desc: string; sens: SensitivityLabel };

export const CONSOLE_TRUST_ZONES: TrustZone[] = [
  { name: "public", tag: "all agents", sens: "public", desc: "Readable by any approved key. Company-wide context with nothing confidential." },
  { name: "internal", tag: "role-gated", sens: "internal", desc: "Reader and writer keys see it; surfaced only to roles whose labels include internal." },
  {
    name: "restricted",
    tag: "admin trust zone",
    sens: "restricted",
    desc: "Only admin keys can discover or read. Titles, bodies, and semantic neighbors are withheld from everyone else.",
  },
];
