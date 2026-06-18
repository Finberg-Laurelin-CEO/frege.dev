export const SENSITIVITY_LABELS = ["public", "internal", "restricted"] as const;
export type SensitivityLabel = (typeof SENSITIVITY_LABELS)[number];

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
  created_at: Date | string;
};

export type ApiKeyRecord = {
  id: string;
  org_id: string;
  role_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
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
