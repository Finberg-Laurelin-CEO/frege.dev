import { routeError } from "@/lib/core/request-guards";
import { v2PreviewDisabledResponse, v2PreviewEnabled } from "@/lib/core/v2-preview";
import { authenticateV2Credential } from "@/lib/v2/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!v2PreviewEnabled()) return v2PreviewDisabledResponse();

  try {
    const authResult = await authenticateV2Credential(req);
    if (!authResult.ok) return authResult.response;
    const { auth } = authResult;
    return Response.json(
      {
        organization: auth.organization,
        principal: auth.principal,
        credential: auth.credential,
        policy: {
          id: auth.policy.id,
          slug: auth.policy.slug,
          version: auth.policy.version,
          default_decision: auth.policy.default_decision,
          rules_digest: auth.policy.rules_digest,
          valid: auth.policy.valid,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return routeError("v2 me failed", err);
  }
}
