#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_WORKER_ID = `frege-worker-${process.pid}`;

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function defaultModelBaseUrl(config) {
  if (config.base_url) return String(config.base_url).replace(/\/+$/, "");
  if (config.provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (config.provider === "vercel-ai-gateway") return "https://ai-gateway.vercel.sh/v1";
  if (config.provider === "ollama") return "http://localhost:11434";
  throw new Error(`model_base_url_missing:${config.provider}`);
}

async function frege(pathname, options = {}) {
  const baseUrl = normalizeBaseUrl(process.env.FREGE_BASE_URL);
  const runtimeToken = process.env.FREGE_RUNTIME_TOKEN;
  if (!runtimeToken) throw new Error("FREGE_RUNTIME_TOKEN is not set.");

  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${runtimeToken}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(JSON.stringify({ status: response.status, error: json.error ?? "request_failed" }));
  }
  return json;
}

async function claim(workerId, limit, leaseSeconds) {
  return frege("/api/v1/runtime/agent-runs/claim", {
    method: "POST",
    body: {
      worker_id: workerId,
      limit,
      lease_seconds: leaseSeconds,
    },
  });
}

async function complete(runId, workerId, body) {
  return frege(`/api/v1/runtime/agent-runs/${encodeURIComponent(runId)}/complete`, {
    method: "POST",
    body: {
      worker_id: workerId,
      ...body,
    },
  });
}

async function callOpenAiCompatible(packet) {
  const config = packet.model_config;
  const response = await fetch(`${defaultModelBaseUrl(config)}/chat/completions`, {
    method: "POST",
    headers: {
      ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model_name,
      messages: [{ role: "user", content: packet.prompt }],
      max_tokens: Number(process.env.FREGE_AGENT_MAX_TOKENS ?? 900),
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`model_provider_error_${response.status}:${JSON.stringify(json).slice(0, 500)}`);
  const content = json.choices?.[0]?.message?.content ?? "";
  return {
    content,
    usage: {
      input_tokens: json.usage?.prompt_tokens,
      output_tokens: json.usage?.completion_tokens,
      estimated_cost_usd: null,
    },
  };
}

async function callOllama(packet) {
  const config = packet.model_config;
  const response = await fetch(`${defaultModelBaseUrl(config)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model_name,
      stream: false,
      messages: [{ role: "user", content: packet.prompt }],
      options: { num_predict: Number(process.env.FREGE_AGENT_MAX_TOKENS ?? 900) },
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`model_provider_error_${response.status}:${JSON.stringify(json).slice(0, 500)}`);
  return {
    content: json.message?.content ?? "",
    usage: {
      input_tokens: json.prompt_eval_count,
      output_tokens: json.eval_count,
      estimated_cost_usd: 0,
    },
  };
}

async function callModel(packet) {
  if (packet.model_config.provider === "ollama") return callOllama(packet);
  return callOpenAiCompatible(packet);
}

async function runPacket(packet, workerId) {
  try {
    const result = await callModel(packet);
    await complete(packet.run.id, workerId, {
      status: "succeeded",
      result_md: result.content,
      usage: result.usage,
    });
    console.log(`completed ${packet.run.id} ${packet.agent.slug}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await complete(packet.run.id, workerId, {
      status: "failed",
      error: message,
    }).catch((completeErr) => {
      console.error(`failed to mark ${packet.run.id} failed:`, completeErr instanceof Error ? completeErr.message : completeErr);
    });
    console.error(`failed ${packet.run.id}: ${message}`);
  }
}

async function tick(options) {
  const claimed = await claim(options.workerId, options.limit, options.leaseSeconds);
  const packets = claimed.packets ?? [];
  if (!packets.length) {
    if (options.verbose) console.log("no queued agent runs");
    return 0;
  }
  for (const packet of packets) {
    await runPacket(packet, options.workerId);
  }
  return packets.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    workerId: String(args["worker-id"] || process.env.FREGE_WORKER_ID || DEFAULT_WORKER_ID),
    limit: Number(args.limit ?? process.env.FREGE_WORKER_LIMIT ?? 1),
    leaseSeconds: Number(args["lease-seconds"] ?? process.env.FREGE_WORKER_LEASE_SECONDS ?? 300),
    intervalMs: Number(args.interval ?? process.env.FREGE_WORKER_INTERVAL_MS ?? 5000),
    once: Boolean(args.once ?? process.env.FREGE_WORKER_ONCE),
    verbose: Boolean(args.verbose),
  };

  console.log(`Frege agent worker ${options.workerId} -> ${normalizeBaseUrl(process.env.FREGE_BASE_URL)}`);
  do {
    await tick(options);
    if (options.once) break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  } while (true);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
