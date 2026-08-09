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
export const MCP_MAX_REQUEST_ID_BYTES = 256;
export const MCP_MAX_HOST_HEADER_BYTES = 512;
export const MCP_MAX_ORIGIN_HEADER_BYTES = 2048;

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

export function oversizedMcpAuthorityHeaderResponse(req: Request): Response | null {
  const host = req.headers.get("host");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const origin = req.headers.get("origin");
  const tooLarge = (value: string | null, maxBytes: number) =>
    value !== null && Buffer.byteLength(value, "utf8") > maxBytes;
  if (
    tooLarge(host, MCP_MAX_HOST_HEADER_BYTES) ||
    tooLarge(forwardedHost, MCP_MAX_HOST_HEADER_BYTES)
  ) {
    return secureMcpResponse(jsonRpcError(403, -32003, "Forbidden host"));
  }
  if (tooLarge(origin, MCP_MAX_ORIGIN_HEADER_BYTES)) {
    return secureMcpResponse(jsonRpcError(403, -32003, "Forbidden origin"));
  }
  return null;
}

type JsonIdMetadata = {
  memberCount: number;
  numericSource: string | undefined;
};

// Native JSON.parse loses the numeric lexeme before validation (for example,
// 1e-400 becomes 0). Scan the already-bounded, valid JSON wire once so the
// top-level ID can be checked losslessly and ambiguous duplicate IDs rejected.
function topLevelJsonIdMetadata(text: string): JsonIdMetadata {
  let depth = 0;
  let memberCount = 0;
  let numericSource: string | undefined;
  const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const isWhitespace = (char: string) =>
    char === " " || char === "\t" || char === "\n" || char === "\r";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      for (index += 1; index < text.length; index += 1) {
        if (text[index] === "\\") {
          index += 1;
          continue;
        }
        if (text[index] === '"') break;
      }
      if (depth !== 1) continue;

      let afterKey = index + 1;
      while (afterKey < text.length && isWhitespace(text[afterKey])) afterKey += 1;
      if (text[afterKey] !== ":") continue;
      const key = JSON.parse(text.slice(start, index + 1)) as unknown;
      if (key !== "id") continue;

      memberCount += 1;
      if (memberCount !== 1) {
        numericSource = undefined;
        continue;
      }
      let valueStart = afterKey + 1;
      while (valueStart < text.length && isWhitespace(text[valueStart])) valueStart += 1;
      numberToken.lastIndex = valueStart;
      numericSource = numberToken.exec(text)?.[0];
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
  }

  return { memberCount, numericSource };
}

function parseJsonWithIdSource(text: string): {
  value: unknown;
  idMemberCount: number;
  numericIdSource: string | undefined;
} {
  const value = JSON.parse(text) as unknown;
  const metadata = topLevelJsonIdMetadata(text);
  return {
    value,
    idMemberCount: metadata.memberCount,
    numericIdSource: metadata.numericSource,
  };
}

function normalizedTrustedJsonRpcId(value: unknown): string | number | null {
  if (typeof value === "string") {
    return Buffer.byteLength(value, "utf8") <= MCP_MAX_REQUEST_ID_BYTES ? value : null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value === 0 ? 0 : value;
  }
  return null;
}

function normalizedParsedJsonRpcId(
  value: unknown,
  numericIdSource: string | undefined,
): string | number | null {
  if (typeof value === "string") return normalizedTrustedJsonRpcId(value);
  if (
    typeof value === "number" &&
    typeof numericIdSource === "string" &&
    /^(?:0|-?[1-9]\d*)$/.test(numericIdSource) &&
    Number.isSafeInteger(value)
  ) {
    return value;
  }
  return null;
}

function responseIdMatches(
  value: unknown,
  numericIdSource: string | undefined,
  expected: string | number | null,
): boolean {
  if (expected === null) return value === null;
  return normalizedParsedJsonRpcId(value, numericIdSource) === expected;
}

function acceptsMcpResponseTypes(header: string | null): boolean {
  if (!header) return false;
  const accepted = new Set<string>();
  for (const range of header.split(",")) {
    const [mediaType, ...parameters] = range.split(";").map((part) => part.trim().toLowerCase());
    if (!mediaType) continue;
    const qValues = parameters
      .map((parameter) => parameter.match(/^q\s*=\s*(.*)$/)?.[1])
      .filter((value): value is string => value !== undefined);
    if (qValues.length > 1) continue;
    const qValue = qValues[0];
    if (qValue !== undefined && !/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(qValue)) {
      continue;
    }
    const quality = qValue === undefined ? 1 : Number(qValue);
    if (quality > 0) accepted.add(mediaType);
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
  let idMemberCount = 0;
  let numericIdSource: string | undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = parseJsonWithIdSource(text);
    value = parsed.value;
    idMemberCount = parsed.idMemberCount;
    numericIdSource = parsed.numericIdSource;
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
  const hasRequestId = Object.prototype.hasOwnProperty.call(message, "id");
  const responseId =
    idMemberCount === 1
      ? normalizedParsedJsonRpcId(message.id, numericIdSource)
      : null;
  if (message.jsonrpc !== "2.0") {
    return {
      ok: false,
      response: jsonRpcError(400, -32600, "JSON-RPC version must be 2.0", responseId),
    };
  }
  if (idMemberCount === 0 || !hasRequestId || message.id === null) {
    return { ok: false, response: jsonRpcError(400, -32600, "Notifications are not supported") };
  }
  if (idMemberCount !== 1) {
    return {
      ok: false,
      response: jsonRpcError(400, -32600, "JSON-RPC request id must appear exactly once"),
    };
  }
  if (responseId === null) {
    return {
      ok: false,
      response: jsonRpcError(
        400,
        -32600,
        `JSON-RPC request id must be a canonical safe integer or a string up to ${MCP_MAX_REQUEST_ID_BYTES} UTF-8 bytes`,
      ),
    };
  }
  // Keep the body value identical to the validated/canonical ID used by every
  // locally generated error and by the final response correlation gate.
  message.id = responseId;
  if (typeof message.method !== "string") {
    return {
      ok: false,
      response: jsonRpcError(400, -32600, "JSON-RPC request method is required", responseId),
    };
  }
  if (!HOSTED_METHODS.has(message.method)) {
    return {
      ok: false,
      response: jsonRpcError(404, -32601, "Method not found", responseId),
    };
  }

  return { ok: true, value: message };
}

export async function finalizeMcpResponse(
  response: Response,
  options: { maxBytes?: number; requestId?: string | number | null } = {},
): Promise<Response> {
  const maxBytes = options.maxBytes ?? MCP_MAX_RESULT_BYTES;
  // Sanitize again at this trust boundary so no caller can make a replacement
  // error exceed the production cap by supplying an unvalidated ID.
  const requestId = normalizedTrustedJsonRpcId(options.requestId);
  const finalError = (message: string) => {
    const withId = JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32603, message },
      id: requestId,
    });
    const errorId = Buffer.byteLength(withId, "utf8") <= maxBytes ? requestId : null;
    return secureMcpResponse(jsonRpcError(500, -32603, message, errorId));
  };

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" || !response.body) {
    return finalError("Invalid MCP response");
  }

  const rawLength = response.headers.get("content-length");
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > maxBytes) {
    return finalError("MCP response too large");
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
        return finalError("MCP response too large");
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return finalError("Invalid MCP response");
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let envelope: unknown;
  let responseIdMemberCount = 0;
  let responseNumericIdSource: string | undefined;
  try {
    const parsed = parseJsonWithIdSource(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    envelope = parsed.value;
    responseIdMemberCount = parsed.idMemberCount;
    responseNumericIdSource = parsed.numericIdSource;
  } catch {
    return finalError("Invalid MCP response");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return finalError("Invalid MCP response");
  }
  const record = envelope as Record<string, unknown>;
  const hasResult = Object.prototype.hasOwnProperty.call(record, "result");
  const hasError = Object.prototype.hasOwnProperty.call(record, "error");
  if (
    record.jsonrpc !== "2.0" ||
    responseIdMemberCount !== 1 ||
    !Object.prototype.hasOwnProperty.call(record, "id") ||
    !responseIdMatches(record.id, responseNumericIdSource, requestId) ||
    hasResult === hasError
  ) {
    return finalError("Invalid MCP response");
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
