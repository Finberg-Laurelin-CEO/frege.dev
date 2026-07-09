import { getSql } from "@/lib/db";
import type { HumanOrgContext } from "@/lib/core/org-guard";
import { decryptSecret, encryptSecret } from "@/lib/core/secret-box";
import type { TrustZone } from "@/lib/core/types";

export type ModelProvider = "openrouter" | "ollama" | "vercel-ai-gateway" | "openai-compatible";

export type ModelConfigInput = {
  slug: string;
  name: string;
  provider: ModelProvider;
  base_url?: string;
  model_name: string;
  allowed_trust_zones: TrustZone[];
  api_key?: string;
  status?: "active" | "disabled";
};

export type ModelConfig = {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  provider: ModelProvider;
  base_url: string | null;
  model_name: string;
  allowed_trust_zones: TrustZone[];
  has_api_key: boolean;
  status: "active" | "disabled";
  created_at: Date | string;
  updated_at: Date | string;
};

type ModelConfigRow = Omit<ModelConfig, "has_api_key"> & {
  encrypted_api_key: string | null;
};

export type ResolvedModelConfig = ModelConfig & {
  api_key: string | null;
};

function toModelConfig(row: ModelConfigRow): ModelConfig {
  return {
    id: row.id,
    org_id: row.org_id,
    slug: row.slug,
    name: row.name,
    provider: row.provider,
    base_url: row.base_url,
    model_name: row.model_name,
    allowed_trust_zones: row.allowed_trust_zones,
    has_api_key: Boolean(row.encrypted_api_key),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listModelConfigs(auth: HumanOrgContext): Promise<ModelConfig[]> {
  const sql = getSql();
  const rows = await sql`
    select *
    from org_model_configs
    where org_id = ${auth.organization.id}
    order by provider asc, slug asc
  `;

  return (rows as ModelConfigRow[]).map(toModelConfig);
}

export async function upsertModelConfig(auth: HumanOrgContext, input: ModelConfigInput): Promise<ModelConfig> {
  const sql = getSql();
  const encryptedApiKey = input.api_key ? encryptSecret(input.api_key) : null;
  const rows = await sql`
    insert into org_model_configs (
      org_id,
      slug,
      name,
      provider,
      base_url,
      model_name,
      allowed_trust_zones,
      encrypted_api_key,
      status,
      created_by_user_id,
      updated_at
    ) values (
      ${auth.organization.id},
      ${input.slug},
      ${input.name},
      ${input.provider},
      ${input.base_url ?? null},
      ${input.model_name},
      ${input.allowed_trust_zones},
      ${encryptedApiKey},
      ${input.status ?? "active"},
      ${auth.user.id},
      now()
    )
    on conflict (org_id, slug) do update set
      name = excluded.name,
      provider = excluded.provider,
      base_url = excluded.base_url,
      model_name = excluded.model_name,
      allowed_trust_zones = excluded.allowed_trust_zones,
      encrypted_api_key = coalesce(excluded.encrypted_api_key, org_model_configs.encrypted_api_key),
      status = excluded.status,
      updated_at = now()
    returning *
  `;

  return toModelConfig(rows[0] as ModelConfigRow);
}

export async function resolveModelConfig(orgId: string, slug: string): Promise<ResolvedModelConfig | null> {
  const sql = getSql();
  const rows = await sql`
    select *
    from org_model_configs
    where org_id = ${orgId}
      and slug = ${slug}
      and status = 'active'
    limit 1
  `;

  const row = rows[0] as ModelConfigRow | undefined;
  if (!row) return null;

  return {
    ...toModelConfig(row),
    api_key: decryptSecret(row.encrypted_api_key),
  };
}
