import { assertSafeOrigin, readJson, routeError } from "@/lib/core/request-guards";
import { authorizeRequestSchema } from "@/lib/v2/contracts";
import { authenticateV2Credential, authorizePublicRequest } from "@/lib/v2/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const originError = assertSafeOrigin(req);
  if (originError) return originError;

  try {
    const authResult = await authenticateV2Credential(req);
    if (!authResult.ok) return authResult.response;

    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = authorizeRequestSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const receipt = await authorizePublicRequest(authResult.auth, parsed.data, req);
    return Response.json(
      { authorization_receipt: receipt },
      {
        status: receipt.decision === "allow" ? 200 : 403,
        headers: { "Cache-Control": "no-store", "X-Frege-Correlation-ID": receipt.correlation_id },
      },
    );
  } catch (err) {
    return routeError("v2 authorization failed", err);
  }
}
