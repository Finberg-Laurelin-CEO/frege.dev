import { getSql } from "@/lib/db";
import type { FregeActorContext } from "@/lib/prototype/actor-auth";
import { appendSessionEvent, brainActorKeyId, brainActorUserId, redactSecrets, startBrainSession } from "@/lib/prototype/brain";
import { buildContextPacket, type ContextPacket } from "@/lib/prototype/context-gateway";
import { compileFregePrompt } from "@/lib/prototype/model-gateway";
import { resolveModelConfig, type ModelProvider } from "@/lib/prototype/model-configs";
import type { HumanOrgContext } from "@/lib/prototype/org-guard";
import type { SensitivityLabel, TrustZone } from "@/lib/prototype/types";

export type AgentDefinition = {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  description: string;
  instructions_md: string;
  model_config_id: string;
  model_config_slug?: string;
  model_provider?: ModelProvider;
  model_name?: string;
  status: "active" | "disabled";
  trust_zone: TrustZone;
  default_context_query: string;
  max_steps: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type AgentRun = {
  id: string;
  org_id: string;
  agent_id: string;
  agent_slug?: string;
  agent_name?: string;
  model_config_id: string;
  model_config_slug?: string;
  session_id: string | null;
  requested_by_user_id: string | null;
  requested_by_key_id: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  input_md: string;
  context_query: string;
  result_md: string;
  error: string | null;
  trust_zone: TrustZone;
  context_build_id: string | null;
  allowed_labels: SensitivityLabel[];
  actor_snapshot: Record<string, unknown>;
  max_steps: number;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
};

export type AgentRunStep = {
  id: string;
  run_id: string;
  step_index: number;
  step_type: "queued" | "context_build" | "model_call" | "complete" | "error" | "note";
  body_md: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
};

export type AgentDefinitionInput = {
  slug: string;
  name: string;
  description?: string;
  instructions_md: string;
  model_config_slug: string;
  status?: "active" | "disabled";
  trust_zone?: TrustZone;
  default_context_query?: string;
  max_steps?: number;
};

export type EnqueueAgentRunInput = {
  agent_slug: string;
  input_md: string;
  context_query?: string;
  session_id?: string;
  trust_zone?: TrustZone;
  max_steps?: number;
  metadata?: Record<string, unknown>;
};

export type RuntimeModelConfigPacket = {
  slug: string;
  provider: ModelProvider;
  base_url: string | null;
  model_name: string;
  api_key: string | null;
  allowed_trust_zones: TrustZone[];
};

export type RuntimeExecutionPacket = {
  run: AgentRun;
  agent: AgentDefinition;
  model_config: RuntimeModelConfigPacket;
  context: ContextPacket;
  prompt: string;
};

type AgentRunRow = AgentRun & {
  org_slug?: string;
  org_name?: string;
  role_id?: string | null;
  role_slug?: string | null;
  role_name?: string | null;
  agent_slug?: string;
  agent_name?: string;
  agent_instructions_md?: string;
  agent_default_context_query?: string;
  agent_max_steps?: number;
  model_config_slug?: string;
};

function normalizeSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

function trustZonesForActor(actor: FregeActorContext): TrustZone[] {
  return actor.allowedLabels.includes("restricted") ? ["green", "red"] : ["green"];
}

function assertCanUseTrustZone(actor: FregeActorContext, trustZone: TrustZone): void {
  if (trustZone === "red" && !trustZonesForActor(actor).includes("red")) {
    throw new Error("trust_zone_forbidden");
  }
}

function assertCanExecuteAgents(actor: FregeActorContext): void {
  if (!actor.capabilities.canExecuteAgents) throw new Error("agent_execute_forbidden");
}

function actorSnapshot(actor: FregeActorContext): Record<string, unknown> {
  if (actor.actorType === "api_key") {
    return {
      actor_type: "api_key",
      organization: actor.organization,
      role: actor.apiKeyAuth.role,
      key: actor.apiKeyAuth.key,
      allowed_labels: actor.allowedLabels,
      capabilities: actor.capabilities,
    };
  }

  return {
    actor_type: "user",
    organization: actor.organization,
    user: actor.userAuth.user,
    membership: actor.userAuth.membership,
    allowed_labels: actor.allowedLabels,
    capabilities: actor.capabilities,
  };
}

function actorFromRun(row: AgentRunRow): FregeActorContext {
  const snapshot = (row.actor_snapshot ?? {}) as Record<string, unknown>;
  const organization = {
    id: row.org_id,
    slug: String(row.org_slug ?? (snapshot.organization as { slug?: string } | undefined)?.slug ?? "runtime-org"),
    name: String(row.org_name ?? (snapshot.organization as { name?: string } | undefined)?.name ?? "Runtime Org"),
    status: String((snapshot.organization as { status?: string } | undefined)?.status ?? "active"),
  };
  const allowedLabels = row.allowed_labels;
  const capabilities = {
    canCreateDocs: false,
    canUpdateDocs: false,
    canReadAudit: false,
    canReadSessions: true,
    canWriteSessions: true,
    canProposeMemory: true,
    canReviewMemoryProposals: false,
    canManageSources: false,
    canExecuteAgents: true,
    ...((snapshot.capabilities as Record<string, boolean> | undefined) ?? {}),
  };

  if (row.requested_by_key_id) {
    const keySnapshot = (snapshot.key as { name?: string; prefix?: string; owner_user_id?: string | null; owner_user_email?: string | null } | undefined) ?? {};
    return {
      actorType: "api_key",
      organization,
      apiKeyAuth: {
        organization,
        role: {
          id: String(row.role_id ?? "runtime-role"),
          slug: String(row.role_slug ?? "runtime"),
          name: String(row.role_name ?? "Runtime"),
        },
        key: {
          id: row.requested_by_key_id,
          name: keySnapshot.name ?? "Agent runtime key",
          prefix: keySnapshot.prefix ?? "runtime",
          owner_user_id: row.requested_by_user_id,
          owner_user_email: keySnapshot.owner_user_email ?? null,
        },
        allowedLabels,
        capabilities,
      },
      allowedLabels,
      capabilities: {
        ...capabilities,
        canManageOrg: false,
        canManageModels: false,
        canManageKeys: false,
      },
    };
  }

  const userSnapshot = (snapshot.user as { id?: string; email?: string; name?: string; status?: string } | undefined) ?? {};
  const membershipSnapshot =
    (snapshot.membership as HumanOrgContext["membership"] | undefined) ??
    ({
      org_id: organization.id,
      org_slug: organization.slug,
      org_name: organization.name,
      org_status: organization.status as HumanOrgContext["membership"]["org_status"],
      role: "admin",
      status: "active",
    } satisfies HumanOrgContext["membership"]);
  const userAuthCapabilities = {
    ...capabilities,
    canManageOrg: false,
    canManageMembers: false,
    canManageKeys: false,
    canManageModels: false,
    canReadAudit: false,
    canReadSessions: true,
    canWriteSessions: true,
    canProposeMemory: true,
    canReviewMemoryProposals: false,
    canManageSources: false,
    canExecuteAgents: true,
  };
  const actorCapabilities = {
    ...capabilities,
    canCreateDocs: false,
    canUpdateDocs: false,
    canReadAudit: false,
    canManageOrg: false,
    canManageKeys: false,
    canManageModels: false,
    canReadSessions: true,
    canWriteSessions: true,
    canProposeMemory: true,
    canReviewMemoryProposals: false,
    canManageSources: false,
    canExecuteAgents: true,
  };

  return {
    actorType: "user",
    organization,
    userAuth: {
      user: {
        id: row.requested_by_user_id ?? userSnapshot.id ?? "runtime-user",
        email: userSnapshot.email ?? "runtime@frege.local",
        name: userSnapshot.name ?? "Frege Runtime",
        status: userSnapshot.status ?? "active",
      },
      organization,
      membership: membershipSnapshot,
      allowedLabels,
      capabilities: userAuthCapabilities,
    },
    allowedLabels,
    capabilities: actorCapabilities,
  };
}

async function insertRunStep(input: {
  orgId: string;
  runId: string;
  stepType: AgentRunStep["step_type"];
  bodyMd?: string;
  payload?: Record<string, unknown>;
}): Promise<AgentRunStep> {
  const sql = getSql();
  const [row] = await sql`
    insert into agent_run_steps (
      org_id,
      run_id,
      step_index,
      step_type,
      body_md,
      payload
    ) values (
      ${input.orgId},
      ${input.runId},
      coalesce((select max(step_index) + 1 from agent_run_steps where run_id = ${input.runId}), 0),
      ${input.stepType},
      ${redactSecrets(input.bodyMd ?? "")},
      ${JSON.stringify(input.payload ?? {})}::jsonb
    )
    returning id, run_id, step_index, step_type, body_md, payload, created_at
  `;
  return row as AgentRunStep;
}

export async function listAgentDefinitionsForAdmin(auth: HumanOrgContext): Promise<AgentDefinition[]> {
  const sql = getSql();
  return (await sql`
    select
      agent_definitions.*,
      org_model_configs.slug as model_config_slug,
      org_model_configs.provider as model_provider,
      org_model_configs.model_name
    from agent_definitions
    join org_model_configs on org_model_configs.id = agent_definitions.model_config_id
    where agent_definitions.org_id = ${auth.organization.id}
    order by agent_definitions.updated_at desc, agent_definitions.slug asc
  `) as AgentDefinition[];
}

export async function listActiveAgentDefinitions(actor: FregeActorContext): Promise<AgentDefinition[]> {
  const sql = getSql();
  return (await sql`
    select
      agent_definitions.*,
      org_model_configs.slug as model_config_slug,
      org_model_configs.provider as model_provider,
      org_model_configs.model_name
    from agent_definitions
    join org_model_configs on org_model_configs.id = agent_definitions.model_config_id
    where agent_definitions.org_id = ${actor.organization.id}
      and agent_definitions.status = 'active'
      and agent_definitions.trust_zone = any(${trustZonesForActor(actor)}::text[])
    order by agent_definitions.slug asc
  `) as AgentDefinition[];
}

export async function upsertAgentDefinitionForAdmin(
  auth: HumanOrgContext,
  input: AgentDefinitionInput,
): Promise<AgentDefinition> {
  const sql = getSql();
  const slug = normalizeSlug(input.slug);
  const [modelConfig] = await sql`
    select id
    from org_model_configs
    where org_id = ${auth.organization.id}
      and slug = ${input.model_config_slug}
    limit 1
  `;
  if (!modelConfig) throw new Error("model_config_not_found");

  const [agent] = await sql`
    insert into agent_definitions (
      org_id,
      slug,
      name,
      description,
      instructions_md,
      model_config_id,
      status,
      trust_zone,
      default_context_query,
      max_steps,
      created_by_user_id,
      updated_at
    ) values (
      ${auth.organization.id},
      ${slug},
      ${input.name},
      ${input.description ?? ""},
      ${redactSecrets(input.instructions_md)},
      ${modelConfig.id},
      ${input.status ?? "active"},
      ${input.trust_zone ?? "green"},
      ${input.default_context_query ?? ""},
      ${input.max_steps ?? 1},
      ${auth.user.id},
      now()
    )
    on conflict (org_id, slug) do update set
      name = excluded.name,
      description = excluded.description,
      instructions_md = excluded.instructions_md,
      model_config_id = excluded.model_config_id,
      status = excluded.status,
      trust_zone = excluded.trust_zone,
      default_context_query = excluded.default_context_query,
      max_steps = excluded.max_steps,
      updated_at = now()
    returning *
  `;

  return agent as AgentDefinition;
}

export async function enqueueAgentRun(actor: FregeActorContext, input: EnqueueAgentRunInput): Promise<AgentRun> {
  assertCanExecuteAgents(actor);
  const sql = getSql();
  const [agent] = (await sql`
    select
      agent_definitions.*,
      org_model_configs.slug as model_config_slug
    from agent_definitions
    join org_model_configs on org_model_configs.id = agent_definitions.model_config_id
    where agent_definitions.org_id = ${actor.organization.id}
      and agent_definitions.slug = ${input.agent_slug}
      and agent_definitions.status = 'active'
    limit 1
  `) as Array<AgentDefinition & { model_config_slug: string }>;
  if (!agent) throw new Error("agent_not_found");

  const trustZone = input.trust_zone ?? agent.trust_zone;
  assertCanUseTrustZone(actor, trustZone);

  const session = input.session_id
    ? { id: input.session_id }
    : await startBrainSession(actor, {
        client: "frege-agent-runtime",
        title: `Agent run: ${agent.name}`,
        goal: input.input_md.slice(0, 500),
        trust_zone: trustZone,
        metadata: { agent_slug: agent.slug },
      });

  const [run] = await sql`
    insert into agent_runs (
      org_id,
      agent_id,
      model_config_id,
      session_id,
      requested_by_user_id,
      requested_by_key_id,
      input_md,
      context_query,
      trust_zone,
      allowed_labels,
      actor_snapshot,
      max_steps,
      metadata
    ) values (
      ${actor.organization.id},
      ${agent.id},
      ${agent.model_config_id},
      ${session.id},
      ${brainActorUserId(actor)},
      ${brainActorKeyId(actor)},
      ${redactSecrets(input.input_md)},
      ${input.context_query ?? agent.default_context_query ?? ""},
      ${trustZone},
      ${actor.allowedLabels},
      ${JSON.stringify(actorSnapshot(actor))}::jsonb,
      ${input.max_steps ?? agent.max_steps},
      ${JSON.stringify(input.metadata ?? {})}::jsonb
    )
    returning *
  `;

  const typedRun = run as AgentRun;
  await insertRunStep({
    orgId: actor.organization.id,
    runId: typedRun.id,
    stepType: "queued",
    bodyMd: `Queued agent run ${typedRun.id} for ${agent.slug}`,
    payload: { agent_slug: agent.slug, session_id: session.id },
  });
  await appendSessionEvent(actor, {
    session_id: session.id,
    event_type: "tool_call",
    body_md: `Queued Frege agent ${agent.slug}: ${typedRun.id}`,
    payload: { agent_run_id: typedRun.id, agent_slug: agent.slug },
    trust_zone: trustZone,
  });

  return typedRun;
}

export async function listAgentRunsForAdmin(auth: HumanOrgContext, limit = 50): Promise<AgentRun[]> {
  const sql = getSql();
  return (await sql`
    select
      agent_runs.*,
      agent_definitions.slug as agent_slug,
      agent_definitions.name as agent_name,
      org_model_configs.slug as model_config_slug
    from agent_runs
    join agent_definitions on agent_definitions.id = agent_runs.agent_id
    join org_model_configs on org_model_configs.id = agent_runs.model_config_id
    where agent_runs.org_id = ${auth.organization.id}
    order by agent_runs.created_at desc
    limit ${limit}
  `) as AgentRun[];
}

export async function getAgentRunForActor(
  actor: FregeActorContext,
  runId: string,
): Promise<{ run: AgentRun; steps: AgentRunStep[] } | null> {
  const sql = getSql();
  const [run] = (await sql`
    select
      agent_runs.*,
      agent_definitions.slug as agent_slug,
      agent_definitions.name as agent_name,
      org_model_configs.slug as model_config_slug
    from agent_runs
    join agent_definitions on agent_definitions.id = agent_runs.agent_id
    join org_model_configs on org_model_configs.id = agent_runs.model_config_id
    where agent_runs.id = ${runId}
      and agent_runs.org_id = ${actor.organization.id}
      and agent_runs.trust_zone = any(${trustZonesForActor(actor)}::text[])
    limit 1
  `) as AgentRun[];
  if (!run) return null;

  const steps = (await sql`
    select id, run_id, step_index, step_type, body_md, payload, created_at
    from agent_run_steps
    where run_id = ${runId}
      and org_id = ${actor.organization.id}
    order by step_index asc
  `) as AgentRunStep[];

  return { run, steps };
}

export async function claimAgentRunsForRuntime(input: {
  workerId: string;
  limit: number;
  leaseSeconds?: number;
}): Promise<RuntimeExecutionPacket[]> {
  const sql = getSql();
  const leaseSeconds = input.leaseSeconds ?? 300;
  const claimed = (await sql`
    with candidates as (
      select id
      from agent_runs
      where status = 'queued'
        and (lease_expires_at is null or lease_expires_at < now())
      order by created_at asc
      limit ${input.limit}
      for update skip locked
    )
    update agent_runs
    set
      status = 'running',
      lease_owner = ${input.workerId},
      lease_expires_at = now() + (${leaseSeconds}::text || ' seconds')::interval,
      started_at = coalesce(started_at, now()),
      updated_at = now()
    where id in (select id from candidates)
    returning *
  `) as AgentRun[];

  const packets: RuntimeExecutionPacket[] = [];
  for (const run of claimed) {
    try {
      packets.push(await prepareRuntimeExecutionPacket(run.id, input.workerId));
    } catch (err) {
      await failAgentRun(run.id, input.workerId, (err as Error)?.message ?? "runtime_prepare_failed");
    }
  }
  return packets;
}

async function loadRunForRuntime(runId: string): Promise<AgentRunRow | null> {
  const sql = getSql();
  const [run] = (await sql`
    select
      agent_runs.*,
      organizations.slug as org_slug,
      organizations.name as org_name,
      roles.id as role_id,
      roles.slug as role_slug,
      roles.name as role_name,
      agent_definitions.slug as agent_slug,
      agent_definitions.name as agent_name,
      agent_definitions.instructions_md as agent_instructions_md,
      agent_definitions.default_context_query as agent_default_context_query,
      agent_definitions.max_steps as agent_max_steps,
      org_model_configs.slug as model_config_slug
    from agent_runs
    join organizations on organizations.id = agent_runs.org_id
    left join api_keys on api_keys.id = agent_runs.requested_by_key_id
    left join roles on roles.id = api_keys.role_id
    join agent_definitions on agent_definitions.id = agent_runs.agent_id
    join org_model_configs on org_model_configs.id = agent_runs.model_config_id
    where agent_runs.id = ${runId}
    limit 1
  `) as AgentRunRow[];

  return run ?? null;
}

export async function prepareRuntimeExecutionPacket(runId: string, workerId: string): Promise<RuntimeExecutionPacket> {
  const sql = getSql();
  const row = await loadRunForRuntime(runId);
  if (!row) throw new Error("agent_run_not_found");
  if (row.status !== "running") throw new Error("agent_run_not_running");
  if (row.lease_owner !== workerId) throw new Error("agent_run_lease_mismatch");

  const actor = actorFromRun(row);
  const query = row.context_query || row.agent_default_context_query || row.input_md.slice(0, 1000);
  const context = await buildContextPacket(actor, {
    query,
    limit: 8,
    session_id: row.session_id ?? undefined,
  });
  await sql`
    update agent_runs
    set context_build_id = ${context.id}, updated_at = now()
    where id = ${row.id}
  `;
  await insertRunStep({
    orgId: row.org_id,
    runId: row.id,
    stepType: "context_build",
    bodyMd: `Built context ${context.id}`,
    payload: {
      context_build_id: context.id,
      denied_count: context.denied_count,
      document_count: context.documents.length,
      brain_page_count: context.brain_pages.length,
      token_estimate: context.token_estimate,
    },
  });
  if (row.session_id) {
    await appendSessionEvent(actor, {
      session_id: row.session_id,
      event_type: "context_build",
      body_md: `Agent runtime built context ${context.id}`,
      payload: { agent_run_id: row.id, context_build_id: context.id, denied_count: context.denied_count },
      trust_zone: context.trust_zone,
    });
  }

  const modelConfig = await resolveModelConfig(row.org_id, row.model_config_slug ?? "");
  if (!modelConfig) throw new Error("model_config_not_found");
  const taskPrompt = [
    "Agent instructions:",
    row.agent_instructions_md ?? "",
    "",
    "Run input:",
    row.input_md,
    "",
    "Return the result for Frege to store in the run ledger. Cite Frege source slugs when using provided context.",
  ].join("\n");

  return {
    run: { ...row, context_build_id: context.id },
    agent: {
      id: row.agent_id,
      org_id: row.org_id,
      slug: row.agent_slug ?? "",
      name: row.agent_name ?? "",
      description: "",
      instructions_md: row.agent_instructions_md ?? "",
      model_config_id: row.model_config_id,
      model_config_slug: row.model_config_slug,
      status: "active",
      trust_zone: row.trust_zone,
      default_context_query: row.agent_default_context_query ?? "",
      max_steps: row.agent_max_steps ?? row.max_steps,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    model_config: {
      slug: modelConfig.slug,
      provider: modelConfig.provider,
      base_url: modelConfig.base_url,
      model_name: modelConfig.model_name,
      api_key: modelConfig.api_key,
      allowed_trust_zones: modelConfig.allowed_trust_zones,
    },
    context,
    prompt: compileFregePrompt(taskPrompt, context),
  };
}

async function failAgentRun(runId: string, workerId: string, error: string): Promise<void> {
  await completeAgentRunFromRuntime({
    runId,
    workerId,
    status: "failed",
    error,
  });
}

export async function completeAgentRunFromRuntime(input: {
  runId: string;
  workerId: string;
  status: "succeeded" | "failed";
  resultMd?: string;
  error?: string;
  usage?: { input_tokens?: number; output_tokens?: number; estimated_cost_usd?: number | null };
}): Promise<AgentRun> {
  const sql = getSql();
  const row = await loadRunForRuntime(input.runId);
  if (!row) throw new Error("agent_run_not_found");
  if (row.lease_owner !== input.workerId) throw new Error("agent_run_lease_mismatch");

  const resultMd = redactSecrets(input.resultMd ?? "");
  const error = input.error ? redactSecrets(input.error) : null;
  const [updated] = await sql`
    update agent_runs
    set
      status = ${input.status},
      result_md = ${resultMd},
      error = ${error},
      completed_at = now(),
      lease_expires_at = null,
      updated_at = now(),
      metadata = metadata || ${JSON.stringify({ usage: input.usage ?? {} })}::jsonb
    where id = ${input.runId}
      and lease_owner = ${input.workerId}
    returning *
  `;
  const run = updated as AgentRun;

  await insertRunStep({
    orgId: row.org_id,
    runId: row.id,
    stepType: input.status === "succeeded" ? "complete" : "error",
    bodyMd: input.status === "succeeded" ? resultMd : error ?? "Agent run failed",
    payload: { usage: input.usage ?? {} },
  });

  const actor = actorFromRun(row);
  if (row.session_id) {
    await appendSessionEvent(actor, {
      session_id: row.session_id,
      event_type: input.status === "succeeded" ? "assistant_message" : "tool_result",
      body_md: input.status === "succeeded" ? resultMd : `Agent run failed: ${error ?? "unknown"}`,
      payload: { agent_run_id: row.id, status: input.status, usage: input.usage ?? {} },
      trust_zone: row.trust_zone,
    });
  }

  return run;
}
