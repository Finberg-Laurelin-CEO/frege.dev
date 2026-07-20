import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import {
  beginGitHubSetupOwnershipVerification,
  GitHubConnectorError,
  pendingGitHubSetupOrgSlug,
} from "@/lib/core/github-connector";
import { assertGitHubConnectorBetaAccess } from "@/lib/core/github-beta";
import { authenticateUserRequest } from "@/lib/core/session";
import { v2PreviewDisabledResponse, v2PreviewEnabled } from "@/lib/core/v2-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectWith(req: Request, values: Record<string, string>): Response {
  const target = new URL("/prototype", req.url);
  target.searchParams.set("section", "account");
  for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
  return Response.redirect(target, 303);
}

export async function GET(req: Request) {
  if (!v2PreviewEnabled()) return v2PreviewDisabledResponse();

  const url = new URL(req.url);
  const rawState = url.searchParams.get("state") ?? "";
  const installationId = Number(url.searchParams.get("installation_id") ?? "");
  if (!rawState || !Number.isSafeInteger(installationId) || installationId <= 0) {
    return redirectWith(req, { github_setup_error: "invalid_callback" });
  }
  try {
    const session = await authenticateUserRequest(req);
    if (!session) return redirectWith(req, { github_setup_error: "sign_in_required" });
    const orgSlug = await pendingGitHubSetupOrgSlug(session.user.id, rawState);
    if (!orgSlug) return redirectWith(req, { github_setup_error: "invalid_state" });
    const authResult = await authenticateAdminRequest(req, orgSlug);
    if (!authResult.ok) return redirectWith(req, { github_setup_error: "forbidden" });
    if (assertGitHubConnectorBetaAccess(authResult.auth.organization)) {
      return redirectWith(req, { github_setup_error: "beta_not_enabled" });
    }
    const result = await beginGitHubSetupOwnershipVerification(authResult.auth, {
      rawState,
      installationId,
      host: req.headers.get("host"),
    });
    return Response.redirect(result.authorize_url, 302);
  } catch (error) {
    const code = error instanceof GitHubConnectorError ? error.code : "github_setup_failed";
    return redirectWith(req, { github_setup_error: code });
  }
}
