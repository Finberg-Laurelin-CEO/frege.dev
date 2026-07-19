import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import {
  completeGitHubSetupOwnershipVerification,
  GitHubConnectorError,
  pendingGitHubSetupOrgSlug,
} from "@/lib/core/github-connector";
import { assertGitHubConnectorBetaAccess } from "@/lib/core/github-beta";
import { authenticateUserRequest } from "@/lib/core/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectWith(req: Request, values: Record<string, string>): Response {
  const target = new URL("/prototype", req.url);
  target.searchParams.set("section", "account");
  for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
  return Response.redirect(target, 303);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawState = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (url.searchParams.has("error")) {
    return redirectWith(req, { github_setup_error: "user_authorization_denied" });
  }
  if (!rawState || !code) return redirectWith(req, { github_setup_error: "invalid_authorization_callback" });

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
    const result = await completeGitHubSetupOwnershipVerification(authResult.auth, {
      rawState,
      code,
      host: req.headers.get("host"),
    });
    return redirectWith(req, {
      github_setup: "complete",
      github_installation_id: String(result.installation_id),
      github_verified_repositories: String(result.verified_repository_count),
    });
  } catch (error) {
    const codeValue = error instanceof GitHubConnectorError ? error.code : "github_setup_failed";
    return redirectWith(req, { github_setup_error: codeValue });
  }
}
