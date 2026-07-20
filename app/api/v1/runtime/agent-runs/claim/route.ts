import { z } from "zod";
import { claimAgentRunsForRuntime } from "@/lib/core/agent-runtime";
import { readJson, routeError } from "@/lib/core/request-guards";
import { authenticateRuntimeRequest } from "@/lib/core/runtime-auth";
import { hostedExecutionDisabledResponse, hostedExecutionEnabled } from "@/lib/core/hosted-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const claimSchema = z.object({
  worker_id: z.string().trim().min(1).max(160),
  limit: z.number().int().min(1).max(10).default(1),
  lease_seconds: z.number().int().min(30).max(1800).default(300),
});

export async function POST(req: Request) {
  const authError = authenticateRuntimeRequest(req);
  if (authError) return authError;
  if (!hostedExecutionEnabled()) return hostedExecutionDisabledResponse();

  try {
    const json = await readJson(req);
    if (!json.ok) return json.response;
    const parsed = claimSchema.safeParse(json.value);
    if (!parsed.success) {
      return Response.json({ error: "validation", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const packets = await claimAgentRunsForRuntime({
      workerId: parsed.data.worker_id,
      limit: parsed.data.limit,
      leaseSeconds: parsed.data.lease_seconds,
    });
    return Response.json({ packets }, { status: 200 });
  } catch (err) {
    return routeError("runtime claim failed", err);
  }
}
