import { buildOAuthStartResponse, parseOAuthProvider } from "@/lib/core/oauth-core";
import { routeError } from "@/lib/core/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  try {
    const { provider: rawProvider } = await context.params;
    const provider = parseOAuthProvider(rawProvider);
    if (!provider) return Response.json({ error: "oauth_not_configured" }, { status: 404 });

    return buildOAuthStartResponse(req, provider);
  } catch (err) {
    return routeError("oauth start failed", err);
  }
}
