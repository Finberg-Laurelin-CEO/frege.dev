// In-process port of scripts/prototype/frege-agent-worker.mjs model calls.
//
// The .mjs worker runs the model call out-of-band against a running Frege instance;
// this module runs the same call inside the Vercel cron worker so queued runs execute
// without a standalone process. Provider branching mirrors the .mjs worker exactly
// (ollama vs the OpenAI-compatible path shared by openrouter / vercel-ai-gateway /
// openai-compatible). The actual HTTP call lives in lib/core/provider-call.ts (shared
// with the model gateway), which swaps the .mjs worker's bare fetch() for
// fetchWithTimeout so a hung upstream fails as model_timeout instead of holding the
// invocation open.

import type { RuntimeExecutionPacket } from "@/lib/core/agent-runtime";
import { postOllamaChat, postOpenAiCompatibleChat } from "@/lib/core/provider-call";

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

function agentMaxTokens(): number {
  return Number(process.env.FREGE_AGENT_MAX_TOKENS ?? 900);
}

async function callOpenAiCompatible(packet: RuntimeExecutionPacket): Promise<AgentExecutionResult> {
  const json = await postOpenAiCompatibleChat({
    config: packet.model_config,
    prompt: packet.prompt,
    maxTokens: agentMaxTokens(),
    errorStyle: "status_with_body",
  });
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
  const json = await postOllamaChat({
    config: packet.model_config,
    prompt: packet.prompt,
    maxTokens: agentMaxTokens(),
    errorStyle: "status_with_body",
  });
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
