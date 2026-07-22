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
  citations: readonly SkillCitation[],
  sql: SkillsSql,
): Promise<{ ok: boolean; unresolved: string[] }> {
  const unresolved: string[] = [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const citation of citations) {
    const [kind, id] = citation.ref.includes(":")
      ? [citation.ref.slice(0, citation.ref.indexOf(":")), citation.ref.slice(citation.ref.indexOf(":") + 1)]
      : ["any", citation.ref];
    if (!uuid.test(id)) {
      unresolved.push(citation.ref);
      continue;
    }

    let rows: unknown[] = [];
    if (["session-event", "session_event", "event"].includes(kind)) {
      rows = await sql`select id from brain_session_events where id = ${id} limit 1`;
    } else if (["material", "raw-material", "raw_material"].includes(kind)) {
      rows = await sql`select id from raw_materials where id = ${id} limit 1`;
    } else if (kind === "page") {
      rows = await sql`select id from brain_pages where id = ${id} limit 1`;
    } else if (kind === "any") {
      rows = await sql`
        select id from brain_session_events where id = ${id}
        union all select id from raw_materials where id = ${id}
        union all select id from brain_pages where id = ${id}
        limit 1
      `;
    }
    if (rows.length === 0) unresolved.push(citation.ref);
  }

  return { ok: unresolved.length === 0, unresolved };
}

export function renderSkillMd(row: SkillRenderRow): string {
  const frontmatter = row.frontmatter ?? {};
  const description = typeof frontmatter.description === "string" ? frontmatter.description : row.title;
  const citations = Array.isArray(frontmatter.citations)
    ? (frontmatter.citations as SkillCitation[]).filter((citation) => typeof citation?.ref === "string")
    : [];
  const trimmed = row.body_md.trim();
  const body = trimmed.startsWith("---\n")
    ? trimmed.replace(/^---\n[\s\S]*?\n---\n?/, "").trim()
    : trimmed;
  const content = /^#\s/m.test(body) ? body : `# ${row.title}\n\n${body}`.trim();
  const footnotes = citations
    .map((citation, index) => ({ citation, anchor: index + 1 }))
    .filter(({ anchor }) => !new RegExp(`^\\[\\^${anchor}\\]:`, "m").test(content))
    .map(({ citation, anchor }) => `[^${anchor}]: ${citation.label ? `${citation.label} — ` : ""}${citation.ref}`);

  return [
    "---",
    `name: ${JSON.stringify(row.slug)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    content,
    footnotes.length ? `\n${footnotes.join("\n")}` : "",
    "",
  ].join("\n");
}
