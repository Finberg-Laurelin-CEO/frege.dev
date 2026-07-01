// In-process port of scripts/prototype/frege-agent-worker.mjs model calls.
//
// The .mjs worker runs the model call out-of-band against a running Frege instance;
// this module runs the same call inside the Vercel cron worker so queued runs execute
// without a standalone process. Provider branching mirrors the .mjs worker exactly
// (ollama vs the OpenAI-compatible path shared by openrouter / vercel-ai-gateway /
// openai-compatible), but the bare fetch() is swapped for fetchWithTimeout so a hung
// upstream fails as model_timeout instead of holding the invocation open.

import type { RuntimeExecutionPacket, RuntimeModelConfigPacket } from "@/lib/prototype/agent-runtime";
import { fetchWithTimeout, isFetchTimeoutError } from "@/lib/prototype/http";

export type AgentExecutionUsage = {
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number | null;
};

export type AgentExecutionResult = {
  status: "succeeded" | "failed";
  result_md?: string;
  error?: string;
  usage: AgentExecutionUsage;
};

function modelTimeoutMs(): number {
  const raw = Number(process.env.FREGE_MODEL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60000;
}

function agentMaxTokens(): number {
  return Number(process.env.FREGE_AGENT_MAX_TOKENS ?? 900);
}

function defaultModelBaseUrl(config: RuntimeModelConfigPacket): string {
  if (config.base_url) return String(config.base_url).replace(/\/+$/, "");
  if (config.provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (config.provider === "vercel-ai-gateway") return "https://ai-gateway.vercel.sh/v1";
  if (config.provider === "ollama") return "http://localhost:11434";
  throw new Error(`model_base_url_missing:${config.provider}`);
}

// Single fetch entry point so every provider path shares the timeout + abort mapping.
async function fetchModel(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init, { timeoutMs: modelTimeoutMs() });
  } catch (err) {
    if (isFetchTimeoutError(err)) throw new Error("model_timeout");
    throw err;
  }
}

async function callOpenAiCompatible(packet: RuntimeExecutionPacket): Promise<AgentExecutionResult> {
  const config = packet.model_config;
  const response = await fetchModel(`${defaultModelBaseUrl(config)}/chat/completions`, {
    method: "POST",
    headers: {
      ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model_name,
      messages: [{ role: "user", content: packet.prompt }],
      max_tokens: agentMaxTokens(),
    }),
  });
  const json = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!response.ok) throw new Error(`model_provider_error_${response.status}:${JSON.stringify(json).slice(0, 500)}`);
  return {
    status: "succeeded",
    result_md: json.choices?.[0]?.message?.content ?? "",
    usage: {
      input_tokens: json.usage?.prompt_tokens,
      output_tokens: json.usage?.completion_tokens,
      estimated_cost_usd: null,
    },
  };
}

async function callOllama(packet: RuntimeExecutionPacket): Promise<AgentExecutionResult> {
  const config = packet.model_config;
  const response = await fetchModel(`${defaultModelBaseUrl(config)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model_name,
      stream: false,
      messages: [{ role: "user", content: packet.prompt }],
      options: { num_predict: agentMaxTokens() },
    }),
  });
  const json = (await response.json().catch(() => ({}))) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  if (!response.ok) throw new Error(`model_provider_error_${response.status}:${JSON.stringify(json).slice(0, 500)}`);
  return {
    status: "succeeded",
    result_md: json.message?.content ?? "",
    usage: {
      input_tokens: json.prompt_eval_count,
      output_tokens: json.eval_count,
      estimated_cost_usd: 0,
    },
  };
}

export async function executeAgentPacket(packet: RuntimeExecutionPacket): Promise<AgentExecutionResult> {
  if (packet.model_config.provider === "ollama") return callOllama(packet);
  return callOpenAiCompatible(packet);
}
