import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import {
  getGitHubConnectorById,
  GitHubConnectorError,
  listGitHubSyncRuns,
  revokeGitHubConnector,
} from "@/lib/core/github-connector";
import { assertActiveHumanOrg, assertVerifiedHumanUser } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, routeError } from "@/lib/core/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
    const connector = await getGitHubConnectorById(id);
    if (!connector || connector.org_id !== authResult.auth.organization.id) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const syncRuns = await listGitHubSyncRuns(connector.org_id, connector.id);
    return Response.json(
      { connector, sync_runs: syncRuns },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError("github connector read failed", error);
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const unverified = assertVerifiedHumanUser(authResult.auth);
    if (unverified) return unverified;
    const inactive = assertActiveHumanOrg(authResult.auth);
    if (inactive) return inactive;
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
    const revoked = await revokeGitHubConnector(authResult.auth, id);
    if (!revoked) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ revoked: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GitHubConnectorError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    return routeError("github connector revoke failed", error);
  }
}
