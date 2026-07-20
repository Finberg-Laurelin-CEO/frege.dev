import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { createGitHubSetupState, GitHubConnectorError } from "@/lib/core/github-connector";
import { assertGitHubConnectorBetaAccess } from "@/lib/core/github-beta";
import { assertActiveHumanOrg, assertVerifiedHumanUser } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { v2PreviewDisabledResponse, v2PreviewEnabled } from "@/lib/core/v2-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const setupSchema = z.object({ org_slug: z.string().trim().min(1).max(120) }).strict();

export async function POST(req: Request) {
  if (!v2PreviewEnabled()) return v2PreviewDisabledResponse();

  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = setupSchema.safeParse(json.value);
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
    const setup = await createGitHubSetupState(authResult.auth);
    return Response.json(setup, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GitHubConnectorError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    return routeError("github connector setup failed", error);
  }
}
