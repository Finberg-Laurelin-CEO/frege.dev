import { getSql } from "@/lib/db";
import { resolveModelConfig, type ResolvedModelConfig } from "@/lib/prototype/model-configs";
import type { ContextPacket } from "@/lib/prototype/context-gateway";
import type { TrustZone } from "@/lib/prototype/types";

export type ModelInvokeInput = {
  orgId: string;
  modelConfigSlug: string;
  prompt: string;
  contextPacket?: ContextPacket;
  contextBuildId?: string;
  maxTokens?: number;
};

export type ModelInvokeResult = {
  provider: string;
  model: string;
  trust_zone: TrustZone;
  content: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
};

type ContextBuildRow = {
  id: string;
  trust_zone: TrustZone;
  token_estimate: number;
  query: string;
};

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function maxTrustZone(packet?: ContextPacket, fallback: TrustZone = "green"): TrustZone {
  if (!packet) return fallback;
  return packet.trust_zone;
}

function defaultBaseUrl(config: ResolvedModelConfig): string {
  if (config.base_url) return config.base_url.replace(/\/+$/, "");
  if (config.provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (config.provider === "vercel-ai-gateway") return "https://ai-gateway.vercel.sh/v1";
  if (config.provider === "openai-compatible") throw new Error("model_base_url_missing");
  return "http://localhost:11434";
}

function openAiCompatibleHeaders(config: ResolvedModelConfig): Record<string, string> {
  return {
    ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}),
    "Content-Type": "application/json",
  };
}

async function resolveContext(orgId: string, contextBuildId?: string): Promise<ContextBuildRow | null> {
  if (!contextBuildId) return null;

  const sql = getSql();
  const rows = await sql`
    select id, trust_zone, token_estimate, query
    from context_builds
    where org_id = ${orgId}
      and id = ${contextBuildId}
    limit 1
  `;

  return (rows[0] as ContextBuildRow | undefined) ?? null;
}

export async function invokeModel(input: ModelInvokeInput): Promise<ModelInvokeResult> {
  const config = await resolveModelConfig(input.orgId, input.modelConfigSlug);
  if (!config) throw new Error("model_config_not_found");

  const context = await resolveContext(input.orgId, input.contextBuildId);
  const trustZone = maxTrustZone(input.contextPacket, context?.trust_zone ?? "green");
  if (!config.allowed_trust_zones.includes(trustZone)) {
    throw new Error("model_trust_zone_forbidden");
  }

  const prompt = compileFregePrompt(input.prompt, input.contextPacket ?? null);

  if (
    config.provider === "openrouter" ||
    config.provider === "vercel-ai-gateway" ||
    config.provider === "openai-compatible"
  ) {
    if ((config.provider === "openrouter" || config.provider === "vercel-ai-gateway") && !config.api_key) {
      throw new Error("model_api_key_missing");
    }
    const response = await fetch(`${defaultBaseUrl(config)}/chat/completions`, {
      method: "POST",
      headers: openAiCompatibleHeaders(config),
      body: JSON.stringify({
        model: config.model_name,
        messages: [{ role: "user", content: prompt }],
        max_tokens: input.maxTokens ?? 800,
      }),
    });

    if (!response.ok) throw new Error(`model_provider_error_${response.status}`);
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      provider: config.provider,
      model: config.model_name,
      trust_zone: trustZone,
      content: json.choices?.[0]?.message?.content ?? "",
      input_tokens: json.usage?.prompt_tokens ?? estimateTokens(prompt),
      output_tokens: json.usage?.completion_tokens ?? estimateTokens(json.choices?.[0]?.message?.content ?? ""),
      estimated_cost_usd: null,
    };
  }

  const response = await fetch(`${defaultBaseUrl(config)}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model_name,
      stream: false,
      messages: [{ role: "user", content: prompt }],
      options: {
        num_predict: input.maxTokens ?? 800,
      },
    }),
  });

  if (!response.ok) throw new Error(`model_provider_error_${response.status}`);
  const json = (await response.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const content = json.message?.content ?? "";

  return {
    provider: config.provider,
    model: config.model_name,
    trust_zone: trustZone,
    content,
    input_tokens: json.prompt_eval_count ?? estimateTokens(prompt),
    output_tokens: json.eval_count ?? estimateTokens(content),
    estimated_cost_usd: 0,
  };
}

export function compactContextForPrompt(packet: ContextPacket): string {
  return packet.documents
    .map((document) => {
      const chunks = document.chunks
        .map(
          (chunk) =>
            `[source:${document.slug} revision:${document.revision_number} chunk:${chunk.chunk_index}]\n${chunk.body_md}`,
        )
        .join("\n\n");
      return `# ${document.title}\npath: ${document.path}\ntrust_zone: ${document.trust_zone}\nsensitivity: ${document.sensitivity}\nsummary: ${document.summary}\n\n${chunks}`;
    })
    .join("\n\n---\n\n");
}

export function compileFregePrompt(taskPrompt: string, packet: ContextPacket | null): string {
  if (!packet) {
    return [
      "You are executing a Frege-governed task without an attached context packet.",
      "Do not claim access to org documents unless they are provided in the prompt.",
      "",
      "Task:",
      taskPrompt,
    ].join("\n");
  }

  const concepts = packet.concepts
    .map((concept) => `- ${concept.name} (${concept.slug}) from ${concept.document_slug}: ${concept.description}`)
    .join("\n");
  const links = packet.links
    .map((link) => `- ${link.source_slug} ${link.link_type} ${link.target_slug}: ${link.evidence}`)
    .join("\n");

  return [
    "You are executing a Frege-governed task.",
    "Use only the context packet below as authoritative org knowledge.",
    "Cite source slugs when using document facts.",
    "If denied_count is greater than zero, mention that some matching context was not available without naming or guessing denied sources.",
    "",
    `context_build_id: ${packet.id}`,
    `org_slug: ${packet.organization.slug}`,
    `trust_zone: ${packet.trust_zone}`,
    `token_estimate: ${packet.token_estimate}`,
    `denied_count: ${packet.denied_count}`,
    "",
    "Concepts:",
    concepts || "None",
    "",
    "Links:",
    links || "None",
    "",
    "Documents:",
    compactContextForPrompt(packet) || "None",
    "",
    "Task:",
    taskPrompt,
  ].join("\n");
}
