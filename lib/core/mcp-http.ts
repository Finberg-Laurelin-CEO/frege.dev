import {
  hostHeaderValidationResponse,
  originValidationResponse,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import {
  assertActiveOrg,
  authenticatePrototypeRequest,
  type PrototypeAuthContext,
} from "@/lib/core/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/core/rate-limit";
import {
  createHostedMcpHandler,
  finalizeMcpResponse,
  mcpMethodNotAllowed,
  readBoundedMcpJson,
  secureMcpResponse,
} from "@/lib/mcp/protocol";
import {
  hostedReadOnlyTools,
  type HostedMcpActor,
} from "@/lib/core/mcp-http-tools";

let hostedHandler: ReturnType<typeof createHostedMcpHandler> | null = null;

function getHostedHandler(): ReturnType<typeof createHostedMcpHandler> {
  hostedHandler ??= createHostedMcpHandler(hostedReadOnlyTools);
  return hostedHandler;
}

function enabled(): boolean {
  return (
    process.env.FREGE_STATELESS_MCP_ENABLED === "true" &&
    process.env.FREGE_ADMIN_ONLY !== "true"
  );
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hostname(value: string): string | null {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function allowedHostnames(): string[] {
  const values = new Set<string>(["frege.dev"]);
  if (process.env.NODE_ENV !== "production") {
    values.add("localhost");
    values.add("127.0.0.1");
    values.add("[::1]");
  }
  for (const value of [process.env.VERCEL_URL, ...splitList(process.env.FREGE_MCP_ALLOWED_HOSTS)]) {
    if (!value) continue;
    const parsed = hostname(value);
    if (parsed) values.add(parsed);
  }
  return [...values];
}

function allowedOrigins(req: Request, hosts: string[]): Set<string> {
  const values = new Set(hosts.map((host) => `https://${host}`));
  if (process.env.NODE_ENV !== "production") {
    const url = new URL(req.url);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      values.add(url.origin);
    }
  }
  return values;
}

function transportGuard(req: Request): Response | null {
  const hosts = allowedHostnames();
  const hostError = hostHeaderValidationResponse(req, hosts);
  if (hostError) return secureMcpResponse(hostError);

  const originError = originValidationResponse(req, hosts);
  if (originError) return secureMcpResponse(originError);

  const origin = req.headers.get("origin");
  if (origin) {
    let normalized: string;
    try {
      normalized = new URL(origin).origin;
    } catch {
      return secureMcpResponse(Response.json({ error: "invalid_origin" }, { status: 403 }));
    }
    if (!allowedOrigins(req, hosts).has(normalized)) {
      return secureMcpResponse(Response.json({ error: "forbidden_origin" }, { status: 403 }));
    }
  }

  if (req.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return secureMcpResponse(Response.json({ error: "forbidden_origin" }, { status: 403 }));
  }

  const host = req.headers.get("host")?.toLowerCase();
  const forwardedHost = req.headers.get("x-forwarded-host")?.toLowerCase();
  if (host && forwardedHost && host !== forwardedHost) {
    return secureMcpResponse(Response.json({ error: "forbidden_host" }, { status: 403 }));
  }

  if (process.env.NODE_ENV === "production") {
    const forwardedProto = req.headers.get("x-forwarded-proto")?.toLowerCase();
    const protocol = new URL(req.url).protocol;
    if (protocol !== "https:" && forwardedProto !== "https") {
      return secureMcpResponse(Response.json({ error: "https_required" }, { status: 400 }));
    }
  }

  return null;
}

function unauthorized(): Response {
  return secureMcpResponse(
    Response.json(
      { error: "unauthorized" },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="Frege MCP"' },
      },
    ),
  );
}

function authInfo(auth: PrototypeAuthContext): AuthInfo {
  const actor: HostedMcpActor = {
    capabilities: {
      canReadAudit: auth.capabilities.canReadAudit,
      canReadSessions: auth.capabilities.canReadSessions,
    },
  };
  const scopes = ["frege:read"];
  if (actor.capabilities.canReadSessions) scopes.push("frege:sessions:read");
  if (actor.capabilities.canReadAudit) scopes.push("frege:audit:read");
  return {
    // The SDK requires this shape but does not verify it. Never copy the raw
    // bearer secret into SDK context; callbacks recover the per-request header
    // only from requestInfo when invoking existing authenticated routes.
    token: "frege-authenticated",
    clientId: "frege-api-key",
    scopes,
    extra: { fregeActor: actor },
  };
}

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function rateLimit(req: Request, auth?: PrototypeAuthContext): Promise<Response | null> {
  try {
    const result = await checkRateLimit(req, {
      action: auth ? "mcp_http_key" : "mcp_http_auth",
      limit: auth
        ? intEnv("FREGE_MCP_KEY_REQUESTS_PER_MINUTE", 120)
        : intEnv("FREGE_MCP_AUTH_REQUESTS_PER_MINUTE", 60),
      windowSeconds: 60,
      keyParts: auth ? [auth.organization.id, auth.key.id] : undefined,
      // The pre-auth bucket is IP-global; the authenticated bucket must be
      // key-global so rotating source IPs cannot multiply one key's allowance.
      includeClientIp: !auth,
    });
    return result.allowed ? null : secureMcpResponse(rateLimitedResponse(result));
  } catch {
    return secureMcpResponse(Response.json({ error: "rate_limit_unavailable" }, { status: 503 }));
  }
}

export async function handleHostedMcpRequest(req: Request): Promise<Response> {
  if (!enabled()) {
    return secureMcpResponse(Response.json({ error: "not_found" }, { status: 404 }));
  }

  const guardError = transportGuard(req);
  if (guardError) return guardError;

  if (req.method.toUpperCase() !== "POST") return mcpMethodNotAllowed();

  if (req.headers.has("cookie")) {
    return secureMcpResponse(Response.json({ error: "cookie_auth_not_supported" }, { status: 400 }));
  }
  const authorization = req.headers.get("authorization")?.trim() ?? "";
  if (authorization.length > 512 || !/^Bearer\s+\S+$/i.test(authorization)) return unauthorized();

  const preAuthLimit = await rateLimit(req);
  if (preAuthLimit) return preAuthLimit;

  let auth: PrototypeAuthContext | null;
  try {
    auth = await authenticatePrototypeRequest(req);
  } catch {
    return secureMcpResponse(
      Response.json({ error: "authentication_unavailable" }, { status: 503 }),
    );
  }
  if (!auth) return unauthorized();

  const keyLimit = await rateLimit(req, auth);
  if (keyLimit) return keyLimit;

  const inactive = assertActiveOrg(auth);
  if (inactive) return secureMcpResponse(inactive);

  const parsed = await readBoundedMcpJson(req);
  if (!parsed.ok) return secureMcpResponse(parsed.response);

  try {
    const response = await getHostedHandler().fetch(req, {
      authInfo: authInfo(auth),
      parsedBody: parsed.value,
    });
    return await finalizeMcpResponse(response);
  } catch {
    return secureMcpResponse(
      Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        },
        { status: 500 },
      ),
    );
  }
}
