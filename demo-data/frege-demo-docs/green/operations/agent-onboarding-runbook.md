# Agent Onboarding Runbook

Use this runbook when a pilot team connects a new coding agent, support agent, or internal automation to Frege. The goal is to give the agent governed memory access without handing it a human session or broad database permissions.

## Steps

1. Confirm the team has an active organization in the Frege control plane.
2. Create a role that matches the agent's job. Start with `public` and `internal` labels only.
3. Generate a per-owner API key and copy the raw key immediately. Frege shows it once.
4. On the agent machine, run `frege connect https://frege.dev --token <key>` and then `frege doctor`.
5. Register `frege mcp serve` with the agent client.
6. Ask the agent to call `frege_brain_status` before using any memory tools.
7. Run one small search and one context build before giving the agent real work.

## Acceptance Criteria

The agent should show the expected org slug, role, key prefix, and allowed trust zones. It should cite page slugs from Frege context and should never claim access to denied or restricted material.
