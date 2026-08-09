import {
  McpServer,
  createMcpHandler,
  isJsonContentType,
  type AuthInfo,
  type McpRequestContext,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";

export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_MAX_REQUEST_BYTES = 1024 * 1024;
export const MCP_MAX_RESULT_BYTES = 512 * 1024;

const HOSTED_METHODS = new Set(["server/discover", "tools/list", "tools/call", "initialize"]);

const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export type HostedMcpExecutionContext = {
  authInfo?: AuthInfo;
  requestInfo?: Request;
};

export type HostedMcpTool = {
  name: string;
  description: string;
  inputSchema: StandardSchemaWithJSON;
  annotations?: ToolAnnotations;
  execute: (input: unknown, context: HostedMcpExecutionContext) => Promise<unknown>;
};

export type HostedMcpToolResolver = (
  context: McpRequestContext,
) => HostedMcpTool[] | Promise<HostedMcpTool[]>;

export class HostedMcpToolError extends Error {
  public readonly publicCode: string;
  public readonly status: number;

  constructor(publicCode: string, status = 400) {
    super(publicCode);
    this.name = "HostedMcpToolError";
    this.publicCode = publicCode;
    this.status = status;
  }
}

function safeToolError(err: unknown): { error: string; status: number } {
  if (err instanceof HostedMcpToolError) {
    return { error: err.publicCode, status: err.status };
  }
  return { error: "tool_failed", status: 500 };
}

function boundedJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > MCP_MAX_RESULT_BYTES) {
    throw new HostedMcpToolError("result_too_large", 413);
  }
  return text;
}

export function createHostedMcpHandler(resolveTools: HostedMcpToolResolver) {
  return createMcpHandler(
    async (requestContext) => {
      const server = new McpServer(
        { name: "frege-hosted", version: "1.0.0" },
        {
          capabilities: { tools: { listChanged: false } },
          instructions:
            "Read-only hosted Frege tools. Durable Frege task sessions remain explicit application records identified by session_id; this transport keeps no protocol session state.",
        },
      );

      const tools = await resolveTools(requestContext);
      for (const tool of tools) {
        server.registerTool(
          tool.name,
          {
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations ?? READ_ONLY_ANNOTATIONS,
          },
          async (input) => {
            try {
              const output = await tool.execute(input, {
                authInfo: requestContext.authInfo,
                requestInfo: requestContext.requestInfo,
              });
              return {
                content: [{ type: "text" as const, text: boundedJson(output) }],
              };
            } catch (err) {
              const safe = safeToolError(err);
              return {
                isError: true,
                content: [{ type: "text" as const, text: JSON.stringify(safe) }],
              };
            }
          },
        );
      }

      return server;
    },
    {
      legacy: "reject",
      responseMode: "json",
      // Protocol errors can include untrusted tool arguments. The route returns
      // stable SDK responses but deliberately does not mirror them into logs.
      onerror: () => undefined,
    },
  );
}

type JsonReadResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response };

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  id: string | number | null = null,
): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id },
    { status },
  );
}

function acceptsMcpResponseTypes(header: string | null): boolean {
  if (!header) return false;
  const accepted = new Set<string>();
  for (const range of header.split(",")) {
    const [mediaType, ...parameters] = range.split(";").map((part) => part.trim().toLowerCase());
    if (!mediaType) continue;
    const qParameter = parameters.find((parameter) => parameter.startsWith("q="));
    const quality = qParameter ? Number(qParameter.slice(2)) : 1;
    if (Number.isFinite(quality) && quality > 0) accepted.add(mediaType);
  }
  return accepted.has("application/json") && accepted.has("text/event-stream");
}

export async function readBoundedMcpJson(
  req: Request,
  maxBytes = MCP_MAX_REQUEST_BYTES,
): Promise<JsonReadResult> {
  if (!acceptsMcpResponseTypes(req.headers.get("accept"))) {
    return {
      ok: false,
      response: jsonRpcError(406, -32000, "Accept must include application/json and text/event-stream"),
    };
  }

  if (req.headers.has("mcp-session-id") || req.headers.has("last-event-id")) {
    return {
      ok: false,
      response: jsonRpcError(400, -32000, "Protocol session headers are not supported"),
    };
  }

  if (!req.headers.get("mcp-protocol-version")?.trim()) {
    return {
      ok: false,
      response: jsonRpcError(400, -32000, "MCP-Protocol-Version is required"),
    };
  }

  if (!isJsonContentType(req.headers.get("content-type"))) {
    return {
      ok: false,
      response: jsonRpcError(415, -32000, "Content-Type must be application/json"),
    };
  }

  const encoding = req.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") {
    return {
      ok: false,
      response: jsonRpcError(415, -32000, "Content-Encoding is not supported"),
    };
  }

  const rawLength = req.headers.get("content-length");
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength)) {
      return { ok: false, response: jsonRpcError(400, -32600, "Invalid Content-Length") };
    }
    if (Number(rawLength) > maxBytes) {
      return { ok: false, response: jsonRpcError(413, -32600, "Request body too large") };
    }
  }

  if (!req.body) {
    return { ok: false, response: jsonRpcError(400, -32700, "Missing JSON body") };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, response: jsonRpcError(413, -32600, "Request body too large") };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, response: jsonRpcError(400, -32700, "Invalid request body") };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonRpcError(400, -32700, "Invalid JSON") };
  }

  if (Array.isArray(value)) {
    return { ok: false, response: jsonRpcError(400, -32600, "Batch requests are not supported") };
  }
  if (!value || typeof value !== "object") {
    return { ok: false, response: jsonRpcError(400, -32600, "JSON-RPC request must be an object") };
  }

  const message = value as Record<string, unknown>;
  const responseId =
    typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
  if (message.jsonrpc !== "2.0") {
    return {
      ok: false,
      response: jsonRpcError(400, -32600, "JSON-RPC version must be 2.0", responseId),
    };
  }
  if (!("id" in message) || message.id === null) {
    return { ok: false, response: jsonRpcError(400, -32600, "Notifications are not supported") };
  }
  if (typeof message.id !== "string" && typeof message.id !== "number") {
    return { ok: false, response: jsonRpcError(400, -32600, "JSON-RPC request id must be a string or number") };
  }
  if (typeof message.method !== "string") {
    return {
      ok: false,
      response: jsonRpcError(400, -32600, "JSON-RPC request method is required", message.id),
    };
  }
  if (!HOSTED_METHODS.has(message.method)) {
    return {
      ok: false,
      response: jsonRpcError(404, -32601, "Method not found", message.id),
    };
  }

  return { ok: true, value: message };
}

export async function finalizeMcpResponse(
  response: Response,
  maxBytes = MCP_MAX_RESULT_BYTES,
): Promise<Response> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" || !response.body) {
    return secureMcpResponse(jsonRpcError(500, -32603, "Invalid MCP response"));
  }

  const rawLength = response.headers.get("content-length");
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > maxBytes) {
    return secureMcpResponse(jsonRpcError(500, -32603, "MCP response too large"));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return secureMcpResponse(jsonRpcError(500, -32603, "MCP response too large"));
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return secureMcpResponse(jsonRpcError(500, -32603, "Invalid MCP response"));
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return secureMcpResponse(
    new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  );
}

export function secureMcpResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", "Authorization, Origin");
  headers.delete("Mcp-Session-Id");
  headers.delete("Last-Event-ID");
  headers.delete("Access-Control-Allow-Origin");
  headers.delete("Access-Control-Allow-Credentials");
  headers.delete("Access-Control-Allow-Methods");
  headers.delete("Access-Control-Allow-Headers");
  headers.delete("Access-Control-Expose-Headers");
  headers.delete("Access-Control-Max-Age");
  headers.delete("Set-Cookie");
  headers.delete("Location");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function mcpMethodNotAllowed(): Response {
  return secureMcpResponse(
    Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32601, message: "Method not allowed" },
        id: null,
      },
      { status: 405, headers: { Allow: "POST" } },
    ),
  );
}
