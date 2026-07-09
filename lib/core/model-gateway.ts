import { getSql } from "@/lib/db";
import { resolveModelConfig } from "@/lib/core/model-configs";
import type { ContextPacket } from "@/lib/core/context-gateway";
import { postOllamaChat, postOpenAiCompatibleChat } from "@/lib/core/provider-call";
import { estimateTokens, type TrustZone } from "@/lib/core/types";

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

function maxTrustZone(packet?: ContextPacket, fallback: TrustZone = "green"): TrustZone {
  if (!packet) return fallback;
  return packet.trust_zone;
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
    const json = await postOpenAiCompatibleChat({
      config,
      prompt,
      maxTokens: input.maxTokens ?? 800,
      errorStyle: "status_only",
    });

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

  const json = await postOllamaChat({
    config,
    prompt,
    maxTokens: input.maxTokens ?? 800,
    errorStyle: "status_only",
  });
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
