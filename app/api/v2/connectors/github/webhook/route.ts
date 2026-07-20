import { after } from "next/server";
import { verifyGitHubWebhookSignature } from "@/lib/core/github-app";
import { GitHubConnectorError, webhookBodyWithinLimit } from "@/lib/core/github-connector";
import { claimGitHubWebhook, processClaimedGitHubWebhook } from "@/lib/core/github-webhook";
import { v2PreviewDisabledResponse, v2PreviewEnabled } from "@/lib/core/v2-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!v2PreviewEnabled()) return v2PreviewDisabledResponse();

  const configuredSecret = process.env.FREGE_GITHUB_WEBHOOK_SECRET;
  if (!configuredSecret) return Response.json({ error: "github_webhook_not_configured" }, { status: 503 });

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 1024 * 1024) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > 1024 * 1024) return Response.json({ error: "payload_too_large" }, { status: 413 });
  if (!verifyGitHubWebhookSignature({
    body: bytes,
    signature: req.headers.get("x-hub-signature-256"),
    secret: configuredSecret,
  })) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let rawBody: string;
  let payload: unknown;
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!webhookBodyWithinLimit(rawBody)) throw new Error("too_large");
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const eventName = req.headers.get("x-github-event") ?? "";
    const claim = await claimGitHubWebhook({
      deliveryId: req.headers.get("x-github-delivery") ?? "",
      eventName,
      rawBody,
      payload,
    });
    if (
      claim.duplicate &&
      eventName !== "push" &&
      !["processed", "ignored"].includes(claim.ledgerStatus)
    ) {
      // A previous synchronous authority event still owns its attempt (or its
      // process died before the lease expired). Do not acknowledge it as done;
      // a 5xx keeps GitHub's redelivery schedule alive until it can be reclaimed.
      return Response.json(
        { accepted: false, retry: true },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    if (!claim.duplicate && eventName === "push") {
      after(async () => {
        await processClaimedGitHubWebhook(claim).catch((error) => {
          console.error("github webhook background processing failed", {
            delivery_id: claim.deliveryId,
            error_code: error instanceof GitHubConnectorError ? error.code : "github_webhook_failed",
          });
        });
      });
    } else if (!claim.duplicate) {
      // Installation, repository-selection, and repository lifecycle events
      // change connector identity or authority. Finish those changes before
      // acknowledging so GitHub redelivers on a transient database failure.
      await processClaimedGitHubWebhook(claim);
    }
    return Response.json(
      { accepted: true, duplicate: claim.duplicate, processing: eventName === "push" ? "durable_async" : "complete" },
      { status: eventName === "push" ? 202 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GitHubConnectorError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    console.error("github webhook acceptance failed", { error_code: "github_webhook_accept_failed" });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
