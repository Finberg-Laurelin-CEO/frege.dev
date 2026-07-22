import type { getSql } from "@/lib/db";

type SkillsSql = ReturnType<typeof getSql>;

export type RawMaterial = {
  content: string;
  provenance: Record<string, unknown>;
  occurred_at: string | null;
  source_type: "session" | "markdown_upload";
};

export type SkillCitation = {
  ref: string;
  label?: string;
};

export type SkillRenderRow = {
  slug: string;
  title: string;
  body_md: string;
  frontmatter?: Record<string, unknown>;
};

export const SKILLS_COMPILER_ENABLED = () => process.env.FREGE_SKILLS_COMPILER === "true";

export const SKILL_RETRIEVED = "skill.retrieved";
export const SKILL_CORRECTED = "skill.corrected";
export const ADMIN_SKILLS_ACCEPT = "admin.skills.accept";
export const ADMIN_SKILLS_REJECT = "admin.skills.reject";
export const ADMIN_SKILLS_EXPORT = "admin.skills.export";
export const SKILL_PROPOSAL_RESOURCE = "skill_proposal";

export async function validateCitations(
  _citations: readonly SkillCitation[],
  _sql: SkillsSql,
): Promise<{ ok: boolean; unresolved: string[] }> {
  throw new Error("Not implemented");
}

export function renderSkillMd(_row: SkillRenderRow): string {
  throw new Error("Not implemented");
}
