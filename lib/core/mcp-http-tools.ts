import { z } from "zod4";
import type { AuthInfo, McpRequestContext } from "@modelcontextprotocol/server";
import { clientIp } from "@/lib/core/client-ip";
import {
  HostedMcpToolError,
  MCP_MAX_RESULT_BYTES,
  type HostedMcpTool,
} from "@/lib/mcp/protocol";
import { GET as getMe } from "@/app/api/v1/me/route";
import { GET as getBrainStatus } from "@/app/api/v1/brain/status/route";
import { GET as listSources } from "@/app/api/v1/brain/sources/route";
import { GET as searchPages } from "@/app/api/v1/brain/pages/search/route";
import { GET as getPage } from "@/app/api/v1/brain/pages/[slug]/route";
import { GET as listSkills } from "@/app/api/v1/skills/route";
import { GET as getSkill } from "@/app/api/v1/skills/[slug]/route";
import { GET as listVault } from "@/app/api/v1/brain/vault/route";
import { GET as getPageLinks } from "@/app/api/v1/brain/pages/[slug]/links/route";
import { GET as traverseGraph } from "@/app/api/v1/brain/graph/route";
import { GET as findConnections } from "@/app/api/v1/brain/connections/route";
import { GET as searchSessions } from "@/app/api/v1/sessions/route";
import { GET as getSession } from "@/app/api/v1/sessions/[id]/route";
import { GET as listDocuments } from "@/app/api/v1/documents/route";
import { GET as searchDocuments } from "@/app/api/v1/documents/search/route";
import { GET as readDocument } from "@/app/api/v1/documents/[slug]/route";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
const uuid = z.string().uuid();
const safeSearch = z
  .string()
  .trim()
  .min(2)
  .max(1000)
  .refine((value) => !/[%_]/.test(value), "SQL wildcard characters are not supported");
const emptyInput = z.object({}).strict();

export type HostedMcpActor = {
  capabilities: {
    canReadAudit: boolean;
    canReadSessions: boolean;
  };
};

type DynamicContext = { params: Promise<Record<string, string>> };
type InternalRoute = (req: Request, context: never) => Promise<Response>;

function actorFromAuth(authInfo?: AuthInfo): HostedMcpActor {
  const value = authInfo?.extra?.fregeActor;
  if (!value || typeof value !== "object") {
    throw new HostedMcpToolError("unauthorized", 401);
  }
  return value as HostedMcpActor;
}

function bearerFromRequest(req?: Request): string {
  const authorization = req?.headers.get("authorization")?.trim() ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new HostedMcpToolError("unauthorized", 401);
  }
  return authorization;
}

function safeAttributionHeader(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const safe = value.replace(/[^\x20-\x7e]/g, "").slice(0, maxLength).trim();
  return safe || null;
}

function internalRequest(
  pathname: string,
  authorization: string,
  params: Record<string, string | number | undefined> = {},
  sourceRequest?: Request,
): Request {
  const url = new URL(pathname, "https://frege.internal");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers = new Headers({
    Authorization: authorization,
    "User-Agent":
      safeAttributionHeader(sourceRequest?.headers.get("user-agent") ?? null, 256) ??
      "frege-hosted-mcp/1.0",
    "X-Real-IP": clientIp(sourceRequest),
  });
  const requestId = safeAttributionHeader(
    sourceRequest?.headers.get("x-request-id") ?? sourceRequest?.headers.get("x-vercel-id") ?? null,
    256,
  );
  if (requestId) headers.set("X-Request-ID", requestId);
  return new Request(url, { method: "GET", headers });
}

async function readBoundedRouteText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MCP_MAX_RESULT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new HostedMcpToolError("result_too_large", 413);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MCP_MAX_RESULT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new HostedMcpToolError("result_too_large", 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HostedMcpToolError) throw error;
    throw new HostedMcpToolError("service_unavailable", 503);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HostedMcpToolError("service_unavailable", 503);
  }
}

async function invoke(
  handler: InternalRoute,
  req: Request,
  params?: Record<string, string>,
): Promise<unknown> {
  const context: DynamicContext = { params: Promise.resolve(params ?? {}) };
  const response = await handler(req, context as never);
  const text = await readBoundedRouteText(response);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new HostedMcpToolError("service_unavailable", 503);
  }
  if (!response.ok) {
    const code =
      response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : response.status === 404
            ? "not_found"
            : response.status === 429
              ? "rate_limited"
              : response.status >= 500
                ? "service_unavailable"
                : "invalid_request";
    throw new HostedMcpToolError(code, response.status);
  }
  return payload;
}

function sanitizeStatus(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const value = payload as Record<string, unknown>;
  const organization = (value.organization ?? {}) as Record<string, unknown>;
  const role = (value.role ?? {}) as Record<string, unknown>;
  const key = (value.key ?? {}) as Record<string, unknown>;
  return {
    organization: {
      slug: organization.slug,
      name: organization.name,
      status: organization.status,
    },
    role: { slug: role.slug, name: role.name },
    key: { name: key.name, prefix: key.prefix },
    allowed_labels: value.allowed_labels,
    capabilities: value.capabilities,
  };
}

function sanitizeBrainStatus(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const wrapper = payload as Record<string, unknown>;
  const status = (wrapper.status ?? {}) as Record<string, unknown>;
  const organization = (status.organization ?? {}) as Record<string, unknown>;
  const key = (status.key ?? {}) as Record<string, unknown>;
  return {
    status: {
      organization: {
        slug: organization.slug,
        name: organization.name,
        status: organization.status,
      },
      actor_type: status.actor_type,
      key: status.key ? { name: key.name, prefix: key.prefix } : null,
      allowed_trust_zones: status.allowed_trust_zones,
      capabilities: status.capabilities,
      counts: status.counts,
    },
  };
}

function tool(
  name: string,
  description: string,
  inputSchema: HostedMcpTool["inputSchema"],
  execute: HostedMcpTool["execute"],
): HostedMcpTool {
  return { name, description, inputSchema, execute };
}

export function hostedReadOnlyTools(context: McpRequestContext): HostedMcpTool[] {
  const actor = actorFromAuth(context.authInfo);
  const authorization = bearerFromRequest(context.requestInfo);
  const routedGet = (
    pathname: string,
    params: Record<string, string | number | undefined> = {},
  ) => internalRequest(pathname, authorization, params, context.requestInfo);
  const tools: HostedMcpTool[] = [
    tool(
      "frege_status",
      "Check the Frege role, org status, and capabilities attached to this API key.",
      emptyInput,
      async () => sanitizeStatus(await invoke(getMe, routedGet("/api/v1/me"))),
    ),
    tool(
      "frege_brain_status",
      "Check visible hosted Frege brain counts and trust-zone capabilities.",
      emptyInput,
      async () =>
        sanitizeBrainStatus(
          await invoke(getBrainStatus, routedGet("/api/v1/brain/status")),
        ),
    ),
    tool(
      "frege_list_sources",
      "List hosted brain sources visible to this Frege actor.",
      z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(),
      async (input) => {
        const args = input as { limit?: number };
        return invoke(
          listSources,
          routedGet("/api/v1/brain/sources", { limit: args.limit }),
        );
      },
    ),
    tool(
      "frege_search_pages",
      "Search hosted brain pages visible to this Frege actor.",
      z.object({ query: safeSearch, limit: z.number().int().min(1).max(50).optional() }).strict(),
      async (input) => {
        const args = input as { query: string; limit?: number };
        return invoke(
          searchPages,
          routedGet("/api/v1/brain/pages/search", {
            q: args.query,
            limit: args.limit,
          }),
        );
      },
    ),
    tool(
      "frege_get_page",
      "Read one visible hosted brain page by slug.",
      z.object({ slug }).strict(),
      async (input) => {
        const args = input as { slug: string };
        return invoke(
          getPage,
          routedGet(`/api/v1/brain/pages/${encodeURIComponent(args.slug)}`),
          { slug: args.slug },
        );
      },
    ),
    tool(
      "frege_list_vault",
      "List visible hosted brain pages with outgoing and backlink counts.",
      z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(),
      async (input) => {
        const args = input as { limit?: number };
        return invoke(
          listVault,
          routedGet("/api/v1/brain/vault", { limit: args.limit }),
        );
      },
    ),
    tool(
      "frege_page_links",
      "Read outgoing links, backlinks, and dangling links for one visible page.",
      z.object({ slug }).strict(),
      async (input) => {
        const args = input as { slug: string };
        return invoke(
          getPageLinks,
          routedGet(`/api/v1/brain/pages/${encodeURIComponent(args.slug)}/links`),
          { slug: args.slug },
        );
      },
    ),
    tool(
      "frege_traverse",
      "Traverse a bounded visible brain graph, optionally from one page slug.",
      z
        .object({
          slug: slug.optional(),
          depth: z.number().int().min(1).max(3).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
      async (input) => {
        const args = input as { slug?: string; depth?: number; limit?: number };
        return invoke(
          traverseGraph,
          routedGet("/api/v1/brain/graph", args),
        );
      },
    ),
    tool(
      "frege_find_connections",
      "Find a bounded shortest visible link path between two brain pages.",
      z
        .object({
          from: slug,
          to: slug,
          max_hops: z.number().int().min(1).max(6).optional(),
        })
        .strict(),
      async (input) => {
        const args = input as { from: string; to: string; max_hops?: number };
        return invoke(
          findConnections,
          routedGet("/api/v1/brain/connections", args),
        );
      },
    ),
    tool(
      "frege_list_documents",
      "List documents visible to the Frege API key.",
      z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
      async (input) => {
        const args = input as { limit?: number };
        return invoke(
          listDocuments,
          routedGet("/api/v1/documents", { limit: args.limit }),
        );
      },
    ),
    tool(
      "frege_search_documents",
      "Search documents visible to the Frege API key.",
      z.object({ query: safeSearch, limit: z.number().int().min(1).max(25).optional() }).strict(),
      async (input) => {
        const args = input as { query: string; limit?: number };
        return invoke(
          searchDocuments,
          routedGet("/api/v1/documents/search", {
            q: args.query,
            limit: args.limit,
          }),
        );
      },
    ),
    tool(
      "frege_read_document",
      "Read a visible document by slug.",
      z.object({ slug }).strict(),
      async (input) => {
        const args = input as { slug: string };
        return invoke(
          readDocument,
          routedGet(`/api/v1/documents/${encodeURIComponent(args.slug)}`),
          { slug: args.slug },
        );
      },
    ),
  ];

  if (process.env.FREGE_SKILLS_COMPILER === "true") {
    tools.push(
      tool(
        "frege_list_skills",
        "List approved skills visible to this Frege actor.",
        emptyInput,
        async () => invoke(listSkills, routedGet("/api/v1/skills")),
      ),
      tool(
        "frege_get_skill",
        "Read an approved visible skill by slug.",
        z.object({ slug }).strict(),
        async (input) => {
          const args = input as { slug: string };
          return invoke(
            getSkill,
            routedGet(`/api/v1/skills/${encodeURIComponent(args.slug)}`),
            { slug: args.slug },
          );
        },
      ),
    );
  }

  if (actor.capabilities.canReadSessions) {
    tools.push(
      tool(
        "frege_search_sessions",
        "List or search visible durable Frege task sessions.",
        z
          .object({
            query: safeSearch.optional(),
            limit: z.number().int().min(1).max(50).optional(),
          })
          .strict(),
        async (input) => {
          const args = input as { query?: string; limit?: number };
          return invoke(
            searchSessions,
            routedGet("/api/v1/sessions", {
              q: args.query,
              limit: args.limit,
            }),
          );
        },
      ),
      tool(
        "frege_get_session",
        "Read a visible durable Frege task session by explicit session_id.",
        z.object({ session_id: uuid }).strict(),
        async (input) => {
          const args = input as { session_id: string };
          return invoke(
            getSession,
            routedGet(`/api/v1/sessions/${encodeURIComponent(args.session_id)}`),
            { id: args.session_id },
          );
        },
      ),
    );
  }

  return tools;
}
