import { authenticateFregeActor, telemetryActorForFregeActor } from "@/lib/prototype/actor-auth";
import { getPageLinks, readerForActor } from "@/lib/prototype/brain-graph";
import { routeError } from "@/lib/prototype/request-guards";
import { logTelemetryEvent } from "@/lib/prototype/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const startedAt = Date.now();
  const actorResult = await authenticateFregeActor(req, { allowInactiveUser: true });
  if (!actorResult.ok) return actorResult.response;

  try {
    const { slug } = await context.params;
    const links = await getPageLinks(readerForActor(actorResult.actor), slug);
    if (!links) return Response.json({ error: "not_found" }, { status: 404 });

    await logTelemetryEvent({
      actor: telemetryActorForFregeActor(actorResult.actor),
      req,
      action: "brain.pages.links",
      resourceType: "brain_page",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: {
        slug,
        outgoing: links.outgoing.length,
        backlinks: links.backlinks.length,
        unresolved: links.unresolved.length,
      },
    });

    return Response.json(links, { status: 200 });
  } catch (err) {
    return routeError("brain page links failed", err);
  }
}
