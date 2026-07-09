// Shared model-provider call plumbing (base-URL resolution + the OpenAI-compatible
// and Ollama chat request/response handling) used by both the model gateway
// (lib/core/model-gateway.ts) and the in-process agent executor
// (lib/core/agent-executor.ts).
//
// NOTE: scripts/prototype/frege-agent-worker.mjs intentionally keeps a documented
// standalone copy of this logic for out-of-band execution — do not fold it in here.

import { fetchWithTimeout, isFetchTimeoutError } from "@/lib/core/http";
import type { ModelProvider } from "@/lib/core/model-configs";

export type ProviderCallModelConfig = {
  provider: ModelProvider;
  base_url: string | null;
  model_name: string;
  api_key: string | null;
};

/**
 * How provider errors surface. The two call sites historically differed and both
 * behaviors are preserved:
 * - "status_only" (model gateway): reject non-2xx before parsing, so the error is
 *   just model_provider_error_<status>; a JSON parse failure on an OK response
 *   propagates to the caller.
 * - "status_with_body" (agent executor): parse first (tolerating unparseable
 *   bodies) and append a 500-char response-body snippet to the error for run
 *   diagnostics. Also used to select the more detailed model_base_url_missing
 *   error message.
 */
export type ProviderErrorStyle = "status_only" | "status_with_body";

function modelTimeoutMs(): number {
  const raw = Number(process.env.FREGE_MODEL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60000;
}

// fetch() a model endpoint with a hard timeout; a timeout surfaces as model_timeout
// so a hung upstream fails deterministically instead of holding the request open.
async function fetchModel(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init, { timeoutMs: modelTimeoutMs() });
  } catch (err) {
    if (isFetchTimeoutError(err)) throw new Error("model_timeout");
    throw err;
  }
}

export function defaultModelBaseUrl(
  config: Pick<ProviderCallModelConfig, "provider" | "base_url">,
  options: { detailedError?: boolean } = {},
): string {
  if (config.base_url) return String(config.base_url).replace(/\/+$/, "");
  if (config.provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (config.provider === "vercel-ai-gateway") return "https://ai-gateway.vercel.sh/v1";
  if (config.provider === "openai-compatible") {
    throw new Error(options.detailedError ? `model_base_url_missing:${config.provider}` : "model_base_url_missing");
  }
  return "http://localhost:11434";
}

async function readProviderJson(response: Response, errorStyle: ProviderErrorStyle): Promise<unknown> {
  if (errorStyle === "status_only") {
    if (!response.ok) throw new Error(`model_provider_error_${response.status}`);
    return response.json();
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`model_provider_error_${response.status}:${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

export type OpenAiCompatibleChatJson = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type OllamaChatJson = {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
};

type ProviderChatInput = {
  config: ProviderCallModelConfig;
  prompt: string;
  maxTokens: number;
  errorStyle: ProviderErrorStyle;
};

/** POST /chat/completions for openrouter / vercel-ai-gateway / openai-compatible. */
export async function postOpenAiCompatibleChat(input: ProviderChatInput): Promise<OpenAiCompatibleChatJson> {
  const baseUrl = defaultModelBaseUrl(input.config, { detailedError: input.errorStyle === "status_with_body" });
  const response = await fetchModel(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...(input.config.api_key ? { Authorization: `Bearer ${input.config.api_key}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.config.model_name,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: input.maxTokens,
    }),
  });
  return (await readProviderJson(response, input.errorStyle)) as OpenAiCompatibleChatJson;
}

/** POST /api/chat for a local/remote Ollama endpoint. */
export async function postOllamaChat(input: ProviderChatInput): Promise<OllamaChatJson> {
  const baseUrl = defaultModelBaseUrl(input.config, { detailedError: input.errorStyle === "status_with_body" });
  const response = await fetchModel(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.config.model_name,
      stream: false,
      messages: [{ role: "user", content: input.prompt }],
      options: { num_predict: input.maxTokens },
    }),
  });
  return (await readProviderJson(response, input.errorStyle)) as OllamaChatJson;
}
