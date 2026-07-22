#!/usr/bin/env node

const [command, subcommand, ...rest] = process.argv.slice(2);

if (process.env.FREGE_LIVE_RUN_ROOMS === "true" && command === "run" && subcommand === "codex") {
  const { runBridge } = await import("./frege-run-bridge.mjs");
  const args = rest[0] === "--" ? rest.slice(1) : rest;
  try {
    process.exitCode = await runBridge(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} else {
  await import("./frege-mcp.mjs");
}
