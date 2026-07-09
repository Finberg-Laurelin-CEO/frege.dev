// Self-serve plan cards — single source of truth shared by the signup form
// (app/signup/page.tsx) and the social-signup workspace setup
// (app/setup-workspace). Keys mirror SELF_SERVE_PLAN_KEYS in
// lib/signup-schema.ts.

export type PlanKey = "solo" | "team-monthly" | "team-annual";

export const PLAN_OPTIONS: Array<{
  key: PlanKey;
  name: string;
  price: string;
  detail: string;
}> = [
  {
    key: "solo",
    name: "Solo",
    price: "$20 / month",
    detail: "One user, hosted brain, MCP access, governed memory.",
  },
  {
    key: "team-monthly",
    name: "Team monthly",
    price: "$20 / user / month",
    detail: "Shared org brain with roles, audit, and monthly billing.",
  },
  {
    key: "team-annual",
    name: "Team annual",
    price: "$15 / user / month",
    detail: "Team plan billed yearly at $180 per user.",
  },
];

export function isPlanKey(value: string | null): value is PlanKey {
  return PLAN_OPTIONS.some((option) => option.key === value);
}
