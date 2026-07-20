import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import {
  GitHubConnectorError,
  listGitHubConnectors,
  registerGitHubConnector,
  registerGitHubConnectorSchema,
  syncGitHubConnectorWithManagedAuthority,
} from "@/lib/core/github-connector";
import { GitHubApiError } from "@/lib/core/github-app";
import { assertGitHubConnectorBetaAccess } from "@/lib/core/github-beta";
import { assertActiveHumanOrg, assertVerifiedHumanUser } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { v2PreviewDisabledResponse, v2PreviewEnabled } from "@/lib/core/v2-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!v2PreviewEnabled()) return v2PreviewDisabledResponse();

  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const connectors = await listGitHubConnectors(authResult.auth.organization.id);
    return Response.json({ connectors }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeError("github connector list failed", error);
  }
}

export async function POST(req: Request) {
  if (!v2PreviewEnabled()) return v2PreviewDisabledResponse();

  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = registerGitHubConnectorSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const betaUnavailable = assertGitHubConnectorBetaAccess(authResult.auth.organization);
    if (betaUnavailable) return betaUnavailable;
    const unverified = assertVerifiedHumanUser(authResult.auth);
    if (unverified) return unverified;
    const inactive = assertActiveHumanOrg(authResult.auth);
    if (inactive) return inactive;
    const result = await registerGitHubConnector(authResult.auth, parsed.data);
    const idempotencyKey = `setup:${result.connector.id}:${randomUUID()}`;
    after(async () => {
      await syncGitHubConnectorWithManagedAuthority({
        connectorId: result.connector.id,
        triggerKind: result.created ? "initial" : "manual",
        idempotencyKey,
        requestId: `github-setup:${idempotencyKey}`,
      }).catch((error) => {
        console.error("github connector initial sync failed", {
          connector_id: result.connector.id,
          error_code: error instanceof GitHubConnectorError ? error.code : "github_initial_sync_failed",
        });
      });
    });
    return Response.json(
      { connector: result.connector, initial_sync_queued: true },
      { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GitHubConnectorError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    if (error instanceof GitHubApiError) {
      return Response.json({ error: `github_http_${error.status}` }, { status: 502 });
    }
    return routeError("github connector register failed", error);
  }
}
