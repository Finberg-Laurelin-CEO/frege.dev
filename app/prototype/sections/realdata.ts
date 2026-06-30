"use client";

// Real per-org console data, fetched from the existing admin APIs the console
// already uses. Replaces the demo activity so live users never see fabricated
// events. These endpoints are owner/admin-gated; non-admins get `forbidden`
// and the sections fall back to honest empty states.

import type { StatusKind } from "./ui";

export type RealSummary = {
  total_events?: number;
  denied_events?: number;
  context_builds?: number;
  model_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  avg_latency_ms?: number;
};

export type RealEvent = {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_key_name: string | null;
  actor_key_prefix: string | null;
};

export type RealAgent = {
  id?: string;
  slug: string;
  name: string;
  model_config_slug?: string;
  model_name?: string;
  trust_zone?: string;
  status?: string;
  updated_at?: string;
};

export type FetchState<T> = { loading: boolean; forbidden: boolean; data: T | null };

export async function getJson<T>(url: string): Promise<{ ok: boolean; forbidden: boolean; data: T | null }> {
  try {
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) return { ok: false, forbidden: true, data: null };
    if (!res.ok) return { ok: false, forbidden: false, data: null };
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: Boolean(data), forbidden: false, data };
  } catch {
    return { ok: false, forbidden: false, data: null };
  }
}

const DENIED = /(denied|forbidden|blocked|unauthorized|403)/i;
const PENDING = /(propos|pending|review)/i;

export function eventStatus(ev: RealEvent): StatusKind {
  const metaStatus = String(ev.metadata?.status ?? ev.metadata?.outcome ?? "");
  if (DENIED.test(ev.action) || DENIED.test(metaStatus)) return "denied";
  if (PENDING.test(ev.action) || metaStatus === "pending") return "pending";
  return "ok";
}

export type EventGroup = "runs" | "denied" | "writes" | "other";

export function eventGroup(ev: RealEvent): EventGroup {
  if (eventStatus(ev) === "denied") return "denied";
  if (PENDING.test(ev.action) || /\.(create|update|write)/.test(ev.action)) return "writes";
  if (/^(agent|model|context|documents\.read|documents\.search|map)/.test(ev.action)) return "runs";
  return "other";
}

// "documents.search" -> "documents search"
export function humanizeAction(action: string): string {
  return action.replace(/[._]/g, " ");
}

export function eventActor(ev: RealEvent): string {
  return ev.actor_key_prefix ?? ev.actor_key_name ?? "system";
}

export function eventSummary(ev: RealEvent): string {
  const base = humanizeAction(ev.action);
  if (ev.resource_id) return `${base} · ${ev.resource_id}`;
  if (ev.resource_type) return `${base} · ${ev.resource_type}`;
  return base;
}

export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatCost(usd: number | undefined): string {
  if (usd == null) return "$0.00";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(usd);
}

export function formatLatency(ms: number | undefined): string {
  if (ms == null) return "–";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}
