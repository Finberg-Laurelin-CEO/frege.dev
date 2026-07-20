import { z } from "zod";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { listAgentDefinitionsForAdmin, upsertAgentDefinitionForAdmin } from "@/lib/core/agent-runtime";
import { assertActiveHumanOrg } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";
import { hostedExecutionDisabledResponse, hostedExecutionEnabled } from "@/lib/core/hosted-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agentSchema = z.object({
  org_slug: z.string().min(1),
  slug: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(180),
  description: z.string().max(2000).default(""),
  instructions_md: z.string().trim().min(1).max(50000),
  model_config_slug: z.string().min(1),
  status: z.enum(["active", "disabled"]).default("active"),
  trust_zone: z.enum(["green", "red"]).default("green"),
  default_context_query: z.string().max(1000).default(""),
  max_steps: z.number().int().min(1).max(10).default(1),
});

export async function GET(req: Request) {
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const agents = await listAgentDefinitionsForAdmin(authResult.auth);
    return Response.json({ agents }, { status: 200 });
  } catch (err) {
    return routeError("admin agents list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;
  if (!hostedExecutionEnabled()) return hostedExecutionDisabledResponse();

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = agentSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const inactive = assertActiveHumanOrg(authResult.auth);
    if (inactive) return inactive;
    const agent = await upsertAgentDefinitionForAdmin(authResult.auth, parsed.data);
    await logTelemetryEvent({
      actor: { type: "user", auth: authResult.auth },
      req,
      action: "admin.agents.upsert",
      resourceType: "agent_definition",
      resourceId: agent.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      trustZone: agent.trust_zone,
      metadata: { slug: agent.slug, model_config_id: agent.model_config_id },
    });
    return Response.json({ agent }, { status: 200 });
  } catch (err) {
    if ((err as Error)?.message === "model_config_not_found") {
      return Response.json({ error: "model_config_not_found" }, { status: 404 });
    }
    return routeError("admin agent upsert failed", err);
  }
}
