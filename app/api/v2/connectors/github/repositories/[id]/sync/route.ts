import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { GitHubApiError } from "@/lib/core/github-app";
import { assertGitHubConnectorBetaAccess } from "@/lib/core/github-beta";
import {
  getGitHubConnectorById,
  GitHubConnectorError,
  syncGitHubConnector,
  syncGitHubConnectorWithManagedAuthority,
} from "@/lib/core/github-connector";
import { assertActiveHumanOrg, assertVerifiedHumanUser } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation } from "@/lib/core/request-guards";
import { v2PreviewDisabledResponse, v2PreviewEnabled } from "@/lib/core/v2-preview";
import {
  appendProvenanceEvent,
  authorizeAndRecordV2Action,
  authenticateV2Credential,
  ensureHumanPrincipal,
} from "@/lib/v2/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function idempotencyKey(req: Request): string {
  const provided = req.headers.get("idempotency-key")?.trim();
  if (provided) return provided;
  return `manual:${randomUUID()}`;
}

export async function POST(req: Request, context: RouteContext) {
  if (!v2PreviewEnabled()) return v2PreviewDisabledResponse();

  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });

  try {
    const connector = await getGitHubConnectorById(id);
    if (!connector) return Response.json({ error: "not_found" }, { status: 404 });
    const hasV2Bearer = /^Bearer\s+frg_v2_/i.test(req.headers.get("authorization") ?? "");
    if (hasV2Bearer) {
      const authResult = await authenticateV2Credential(req);
      if (!authResult.ok) return authResult.response;
      if (authResult.auth.organization.id !== connector.org_id) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      const betaUnavailable = assertGitHubConnectorBetaAccess(authResult.auth.organization);
      if (betaUnavailable) return betaUnavailable;
      const receipt = await authorizeAndRecordV2Action({
        auth: authResult.auth,
        action: "connector.sync",
        resource: { orgId: connector.org_id, type: "github.repository", id: connector.id },
        req,
      });
      if (receipt.decision !== "allow") {
        return Response.json(
          { error: "authorization_denied", authorization_receipt: receipt },
          { status: 403, headers: { "Cache-Control": "no-store", "X-Frege-Correlation-ID": receipt.correlation_id } },
        );
      }
      const run = await syncGitHubConnector({
        connectorId: connector.id,
        auth: authResult.auth,
        receipt,
        triggerKind: "manual",
        idempotencyKey: idempotencyKey(req),
      });
      return Response.json(
        { authorization_receipt: receipt, sync_run: run },
        { status: 200, headers: { "Cache-Control": "no-store", "X-Frege-Correlation-ID": receipt.correlation_id } },
      );
    }

    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    if (authResult.auth.organization.id !== connector.org_id) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const betaUnavailable = assertGitHubConnectorBetaAccess(authResult.auth.organization);
    if (betaUnavailable) return betaUnavailable;
    const unverified = assertVerifiedHumanUser(authResult.auth);
    if (unverified) return unverified;
    const inactive = assertActiveHumanOrg(authResult.auth);
    if (inactive) return inactive;
    const correlationId = randomUUID();
    const humanPrincipal = await ensureHumanPrincipal(authResult.auth);
    await appendProvenanceEvent({
      orgId: connector.org_id,
      principalId: humanPrincipal.id,
      eventType: "connector.sync.requested",
      action: "connector.sync",
      resource: { type: "github.repository", id: connector.id },
      outcome: "success",
      correlationId,
      payload: { trigger: "manual" },
    });
    const result = await syncGitHubConnectorWithManagedAuthority({
      connectorId: connector.id,
      triggerKind: "manual",
      idempotencyKey: idempotencyKey(req),
      correlationId,
      req,
    });
    if (result.authorization_receipt.decision !== "allow" || !result.sync_run) {
      return Response.json(
        { error: "authorization_denied", authorization_receipt: result.authorization_receipt },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
            "X-Frege-Correlation-ID": result.authorization_receipt.correlation_id,
          },
        },
      );
    }
    return Response.json(
      result,
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Frege-Correlation-ID": result.authorization_receipt.correlation_id,
        },
      },
    );
  } catch (error) {
    if (error instanceof GitHubConnectorError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    if (error instanceof GitHubApiError) {
      return Response.json({ error: `github_http_${error.status}` }, { status: 502 });
    }
    console.error("github connector sync failed", { error_code: "github_connector_sync_failed" });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
