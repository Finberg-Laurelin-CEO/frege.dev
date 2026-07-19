import { authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/core/auth";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();

    // `/me` is the inexpensive connection check used by CLI and MCP setup.
    // Recording it through the existing best-effort telemetry path gives the
    // activation model an exact first successful API-client observation while
    // keeping credentials and response data out of event metadata.
    await logTelemetryEvent({
      actor: { type: "api_key", auth },
      req,
      action: "api.auth.context.read",
      resourceType: "api_key",
      resourceId: auth.key.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { client_observed: true },
    });

    return Response.json(
      {
        organization: auth.organization,
        role: auth.role,
        key: auth.key,
        allowed_labels: auth.allowedLabels,
        capabilities: auth.capabilities,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error("prototype auth context failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
