import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/prototype/actor-auth";
import { getBrainPage } from "@/lib/prototype/brain";
import { routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const { slug } = await context.params;
    const page = await getBrainPage(actorResult.actor, slug);
    if (!page) return Response.json({ error: "not_found" }, { status: 404 });
    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.pages.read",
      resourceType: "brain_page",
      resourceId: page.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: page.trust_zone,
      metadata: { slug: page.slug },
    });
    return Response.json({ page }, { status: 200 });
  } catch (err) {
    return routeError("brain page read failed", err);
  }
}
