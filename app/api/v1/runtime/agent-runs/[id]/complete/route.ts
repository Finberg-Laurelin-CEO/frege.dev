import { z } from "zod";
import { completeAgentRunFromRuntime } from "@/lib/prototype/agent-runtime";
import { readJson, routeError } from "@/lib/prototype/request-guards";
import { authenticateRuntimeRequest } from "@/lib/prototype/runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const completeSchema = z.object({
  worker_id: z.string().trim().min(1).max(160),
  status: z.enum(["succeeded", "failed"]),
  result_md: z.string().max(100000).optional(),
  error: z.string().max(10000).optional(),
  usage: z
    .object({
      input_tokens: z.number().int().min(0).optional(),
      output_tokens: z.number().int().min(0).optional(),
      estimated_cost_usd: z.number().min(0).nullable().optional(),
    })
    .default({}),
});

export async function POST(req: Request, context: RouteContext) {
  const authError = authenticateRuntimeRequest(req);
  if (authError) return authError;

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = completeSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { id } = await context.params;
    const run = await completeAgentRunFromRuntime({
      runId: id,
      workerId: parsed.data.worker_id,
      status: parsed.data.status,
      resultMd: parsed.data.result_md,
      error: parsed.data.error,
      usage: parsed.data.usage,
    });
    return Response.json({ run }, { status: 200 });
  } catch (err) {
    const message = (err as Error)?.message;
    if (message === "agent_run_not_found") return Response.json({ error: message }, { status: 404 });
    if (message === "agent_run_lease_mismatch") return Response.json({ error: message }, { status: 409 });
    return routeError("runtime complete failed", err);
  }
}
