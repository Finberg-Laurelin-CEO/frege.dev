export const SENSITIVITY_LABELS = ["public", "internal", "restricted"] as const;
export type SensitivityLabel = (typeof SENSITIVITY_LABELS)[number];

export const TRUST_ZONES = ["green", "red"] as const;
export type TrustZone = (typeof TRUST_ZONES)[number];

/**
 * Trust zones an actor may read: only actors allowed to read "restricted"
 * documents may enter the red zone. (Shared by brain, context-gateway, and
 * agent-runtime; structurally typed so this module stays import-free.)
 */
export function trustZonesForActor(actor: { allowedLabels: SensitivityLabel[] }): TrustZone[] {
  return actor.allowedLabels.includes("restricted") ? ["green", "red"] : ["green"];
}

/** Cheap ~4-chars-per-token estimate used when providers don't report usage. */
export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export const DOCUMENT_STATUSES = ["draft", "published", "archived"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const API_KEY_STATUSES = ["active", "revoked"] as const;
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number];

export type Organization = {
  id: string;
  slug: string;
  name: string;
  created_at: Date | string;
};

export type Role = {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  can_read_labels: SensitivityLabel[];
  can_create_docs: boolean;
  can_update_docs: boolean;
  can_read_audit: boolean;
  can_read_sessions?: boolean;
  can_write_sessions?: boolean;
  can_propose_memory?: boolean;
  can_review_memory_proposals?: boolean;
  can_manage_sources?: boolean;
  can_execute_agents?: boolean;
  created_at: Date | string;
};

export type ApiKeyRecord = {
  id: string;
  org_id: string;
  role_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  owner_user_id?: string | null;
  status: ApiKeyStatus;
  created_at: Date | string;
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
};

export type KnowledgeDocument = {
  id: string;
  org_id: string;
  slug: string;
  path: string;
  title: string;
  sensitivity: SensitivityLabel;
  trust_zone?: TrustZone;
  status: DocumentStatus;
  tags: string[];
  created_at: Date | string;
  updated_at: Date | string;
};

export type KnowledgeDocumentRevision = {
  id: string;
  document_id: string;
  revision_number: number;
  body_md: string;
  summary: string;
  created_by_key_id: string | null;
  created_at: Date | string;
};

export const DOCUMENT_LINK_TYPES = ["references", "supersedes", "depends_on", "related", "contradicts"] as const;
export type DocumentLinkType = (typeof DOCUMENT_LINK_TYPES)[number];

export const CONCEPT_EDGE_TYPES = ["related_to", "depends_on", "contradicts", "supersedes"] as const;
export type ConceptEdgeType = (typeof CONCEPT_EDGE_TYPES)[number];

export const SEMANTIC_INDEX_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type SemanticIndexRunStatus = (typeof SEMANTIC_INDEX_RUN_STATUSES)[number];

export const DOCUMENT_REVISION_PROPOSAL_STATUSES = ["pending", "accepted", "rejected"] as const;
export type DocumentRevisionProposalStatus = (typeof DOCUMENT_REVISION_PROPOSAL_STATUSES)[number];

export const BRAIN_SOURCE_STATUSES = ["active", "disabled"] as const;
export type BrainSourceStatus = (typeof BRAIN_SOURCE_STATUSES)[number];

export const BRAIN_PAGE_STATUSES = ["draft", "published", "archived"] as const;
export type BrainPageStatus = (typeof BRAIN_PAGE_STATUSES)[number];

export const BRAIN_SESSION_STATUSES = ["active", "closed"] as const;
export type BrainSessionStatus = (typeof BRAIN_SESSION_STATUSES)[number];

export const BRAIN_SESSION_EVENT_TYPES = [
  "user_message",
  "assistant_message",
  "tool_call",
  "tool_result",
  "context_build",
  "model_invoke",
  "memory_signal",
  "note",
  "run.live.started",
  "run.live.agent_message",
  "run.live.command.started",
  "run.live.command.finished",
  "run.live.file_change",
  "run.live.approval.requested",
  "run.live.approval.resolved",
  "run.live.interrupted",
  "run.live.redirected",
  "run.live.lease.claimed",
  "run.live.lease.handed_off",
  "run.live.lease.released",
  "run.live.bridge.disconnected",
  "run.live.ended",
  "run.live.denied",
] as const;
export type BrainSessionEventType = (typeof BRAIN_SESSION_EVENT_TYPES)[number];

export const MEMORY_PROPOSAL_TYPES = [
  "page_create",
  "page_update",
  "source_create",
  "link_update",
  "skill_create",
  "skill_update",
] as const;
export type MemoryProposalType = (typeof MEMORY_PROPOSAL_TYPES)[number];

export const MEMORY_PROPOSAL_STATUSES = ["pending", "accepted", "rejected"] as const;
export type MemoryProposalStatus = (typeof MEMORY_PROPOSAL_STATUSES)[number];

export type KnowledgeChunk = {
  id: string;
  org_id: string;
  document_id: string;
  revision_id: string;
  chunk_index: number;
  body_md: string;
  token_count: number;
  embedding_model: string | null;
  created_at: Date | string;
};

export type DocumentLink = {
  id: string;
  org_id: string;
  source_document_id: string;
  target_document_id: string;
  source_revision_id: string | null;
  link_type: DocumentLinkType;
  confidence: number;
  evidence: string;
  created_by_key_id: string | null;
  created_at: Date | string;
};

export type ConceptNode = {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  description: string;
  embedding_model: string | null;
  created_at: Date | string;
};

export type ConceptEdge = {
  id: string;
  org_id: string;
  source_concept_id: string;
  target_concept_id: string;
  edge_type: ConceptEdgeType;
  weight: number;
  evidence: Record<string, unknown>;
  created_at: Date | string;
};

export type DocumentConcept = {
  org_id: string;
  document_id: string;
  concept_id: string;
  confidence: number;
  created_at: Date | string;
};

export type SemanticIndexRun = {
  id: string;
  org_id: string;
  document_id: string | null;
  revision_id: string | null;
  status: SemanticIndexRunStatus;
  error: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
};

export type DocumentRevisionProposal = {
  id: string;
  org_id: string;
  document_id: string;
  base_revision_id: string;
  proposed_body_md: string;
  summary: string;
  status: DocumentRevisionProposalStatus;
  created_by_key_id: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
};

export type AuditEvent = {
  id: string;
  org_id: string;
  actor_key_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
};

export type PrototypeRoleSeed = {
  slug: string;
  name: string;
  can_read_labels: SensitivityLabel[];
  can_create_docs: boolean;
  can_update_docs: boolean;
  can_read_audit: boolean;
};

export type PrototypeDocumentSeed = {
  slug: string;
  path: string;
  title: string;
  sensitivity: SensitivityLabel;
  status: DocumentStatus;
  tags: string[];
  summary: string;
  body_md: string;
};
