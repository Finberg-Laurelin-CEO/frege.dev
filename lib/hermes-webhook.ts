import { createHmac, randomUUID } from "node:crypto";

const HERMES_WEBHOOK_TIMEOUT_MS = 4000;

export type HermesWebhookResult =
  | { ok: true }
  | { ok: false; skipped: true; message: string }
  | { ok: false; skipped?: false; status?: number; statusText?: string; message?: string };

/**
 * Founder decision (2026-07): no external monitoring service runs against
 * Frege's data for now. Outbound Hermes webhook POSTs are opt-in via
 * FREGE_EXTERNAL_MONITOR_ENABLED=true (default off); signup monitor events
 * are persisted in-app instead (lib/core/signup-monitor.ts, db/026).
 */
export function externalMonitorEnabled(): boolean {
  return process.env.FREGE_EXTERNAL_MONITOR_ENABLED === "true";
}

export async function postHermesEvent(payload: unknown): Promise<HermesWebhookResult> {
  const webhookUrl = process.env.HERMES_FREGE_SIGNUP_WEBHOOK_URL;
  const webhookSecret = process.env.HERMES_FREGE_WEBHOOK_SECRET;

  if (!externalMonitorEnabled()) {
    return {
      ok: false,
      skipped: true,
      message: "external monitor disabled (set FREGE_EXTERNAL_MONITOR_ENABLED=true to enable)",
    };
  }

  if (!webhookUrl || !webhookSecret) {
    return { ok: false, skipped: true, message: "Hermes webhook is not configured" };
  }

  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", webhookSecret).update(body).digest("hex");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HERMES_WEBHOOK_TIMEOUT_MS);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${webhookSecret}`,
        "X-Hub-Signature-256": `sha256=${signature}`,
        "X-Request-ID": randomUUID(),
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, status: res.status, statusText: res.statusText };
    }

    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, message: (err as Error)?.message };
  } finally {
    clearTimeout(timeout);
  }
}
