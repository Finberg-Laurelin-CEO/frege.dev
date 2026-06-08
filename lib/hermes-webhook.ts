import { createHmac, randomUUID } from "node:crypto";

const HERMES_WEBHOOK_TIMEOUT_MS = 4000;

export type HermesWebhookResult =
  | { ok: true }
  | { ok: false; skipped: true; message: string }
  | { ok: false; skipped?: false; status?: number; statusText?: string; message?: string };

export async function postHermesEvent(payload: unknown): Promise<HermesWebhookResult> {
  const webhookUrl = process.env.HERMES_FREGE_SIGNUP_WEBHOOK_URL;
  const webhookSecret = process.env.HERMES_FREGE_WEBHOOK_SECRET;

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
