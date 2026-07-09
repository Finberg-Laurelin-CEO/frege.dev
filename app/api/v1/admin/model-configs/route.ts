import { z } from "zod";
import { listModelConfigs, upsertModelConfig } from "@/lib/core/model-configs";
import { authenticateAdminRequest } from "@/lib/core/admin-auth";
import { assertActiveHumanOrg } from "@/lib/core/org-guard";
import { assertSafeBrowserMutation, readJson, routeError } from "@/lib/core/request-guards";
import { logTelemetryEvent } from "@/lib/core/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const modelConfigSchema = z.object({
  org_slug: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/).max(80),
  name: z.string().trim().min(1).max(160),
  provider: z.enum(["openrouter", "ollama", "vercel-ai-gateway", "openai-compatible"]),
  base_url: z.string().url().optional(),
  model_name: z.string().trim().min(1).max(200),
  allowed_trust_zones: z.array(z.enum(["green", "red"])).min(1).default(["green"]),
  api_key: z.string().min(1).max(4096).optional(),
  status: z.enum(["active", "disabled"]).default("active"),
});

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const authResult = await authenticateAdminRequest(req);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;

    const modelConfigs = await listModelConfigs(auth);
    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.model_configs.list",
      resourceType: "model_config",
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      metadata: { result_count: modelConfigs.length },
    });

    return Response.json({ model_configs: modelConfigs }, { status: 200 });
  } catch (err) {
    return routeError("admin model config list failed", err);
  }
}

export async function POST(req: Request) {
  const originError = assertSafeBrowserMutation(req);
  if (originError) return originError;

  const startedAt = Date.now();
  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;

    const parsed = modelConfigSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const authResult = await authenticateAdminRequest(req, parsed.data.org_slug);
    if (!authResult.ok) return authResult.response;
    const auth = authResult.auth;
    const inactive = assertActiveHumanOrg(auth);
    if (inactive) return inactive;

    const modelConfig = await upsertModelConfig(auth, parsed.data);
    await logTelemetryEvent({
      actor: { type: "user", auth },
      req,
      action: "admin.model_configs.upsert",
      resourceType: "model_config",
      resourceId: modelConfig.id,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      provider: modelConfig.provider,
      model: modelConfig.model_name,
      trustZone: modelConfig.allowed_trust_zones.includes("red") ? "red" : "green",
      metadata: {
        slug: modelConfig.slug,
        allowed_trust_zones: modelConfig.allowed_trust_zones,
        has_api_key: modelConfig.has_api_key,
      },
    });

    return Response.json({ model_config: modelConfig }, { status: 200 });
  } catch (err) {
    if ((err as Error)?.message === "FREGE_SECRET_KEY is not set.") {
      return Response.json({ error: "secret_key_missing" }, { status: 500 });
    }
    return routeError("admin model config upsert failed", err);
  }
}
