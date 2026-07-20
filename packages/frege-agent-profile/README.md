# Frege Agent

Run a complete AI agent on your own machine while using Frege as its governed
organizational memory.

[Frege](https://frege.dev) ·
[Frege documentation](https://frege.dev/docs#local-agent) ·
[Frege CLI on npm](https://www.npmjs.com/package/@frege-dev/cli) ·
[Hermes Agent](https://github.com/NousResearch/hermes-agent)

This repository is the official Frege Agent profile for Hermes. It contains the
agent instructions, a review-first memory workflow, and a safe Frege MCP
allowlist. It does not contain a model, provider credential, hosted runtime,
gateway, or scheduled job.

## Quick start

You need a Frege account with an active organization and API key. Create or
manage those at [brain.frege.dev](https://brain.frege.dev), then run:

```bash
# 1. Install Hermes Agent (macOS, Linux, or WSL2)
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

# 2. Install the Frege CLI
npm install -g @frege-dev/cli

# 3. Save and verify your Frege connection
frege connect https://frege.dev --token "$FREGE_API_KEY" --no-register
frege doctor

# 4. Install this profile and choose your model
frege agent install hermes
frege-agent setup

# 5. Verify Frege memory and start chatting
frege-agent mcp test frege
frege-agent chat
```

The setup wizard asks you to choose the model provider used by Hermes. That
provider credential stays with Hermes on your machine; it is not sent to Frege.

Expected checks:

- `frege doctor` reports your organization, role, and key prefix.
- `frege-agent mcp test frege` reports the `frege` server as connected.
- The profile exposes 22 governed context, session, and proposal tools.

## What runs where

| Component | Where it runs | What it does |
| --- | --- | --- |
| Hermes and your model | Your machine or infrastructure | Runs the agent loop and local tools |
| `frege mcp serve` | Your machine | Bridges Hermes to the Frege API over stdio |
| Frege | Hosted at `frege.dev` | Returns scoped context and stores governed memory |

Only information explicitly sent through a Frege tool enters Frege. The
profile disables Hermes' built-in persistent-memory toolset so organizational
memory has one governed system of record; Hermes may still retain local session
history.

## Direct profile install

If the Frege CLI is already connected, the equivalent Hermes command is:

```bash
hermes profile install github.com/Finberg-Laurelin-CEO/frege-agent --alias
```

The canonical source is
[`github.com/Finberg-Laurelin-CEO/frege-agent`](https://github.com/Finberg-Laurelin-CEO/frege-agent).
Do not install similarly named profiles from another repository.

## Safe defaults

- Governed reads, selective session events, and reviewable proposals are
  enabled.
- Direct canonical document creation is excluded from the default MCP tool
  allowlist.
- Hosted agent execution and hosted model invocation are excluded.
- No cron jobs, model selection, provider configuration, or credentials ship.
- Retrieved content is treated as evidence, not as instructions that can
  override the user or system.

## Troubleshooting

- `hermes: command not found`: reload your shell, then run `hermes doctor`.
- `frege: command not found`: confirm `npm install -g @frege-dev/cli` completed
  and that npm's global bin directory is on `PATH`.
- Frege authentication failure: run `frege doctor`, create or rotate an API key
  in [brain.frege.dev](https://brain.frege.dev), then reconnect.
- Existing profile needs an update: run `frege agent install hermes --force`.
- MCP test fails: confirm the plain `frege mcp serve` command is available in
  the same shell as `frege-agent`.

## Develop this profile locally

Clone this repository and install the checkout directly:

```bash
git clone https://github.com/Finberg-Laurelin-CEO/frege-agent.git
cd frege-agent
hermes profile install . --name frege-agent-dev --yes
hermes -p frege-agent-dev mcp list
hermes -p frege-agent-dev chat
```

The Frege CLI and hosted product live in the separate
[`frege.dev`](https://github.com/Finberg-Laurelin-CEO/frege.dev) repository.

## License

This distribution is source-visible proprietary preview software. See
[`LICENSE.md`](LICENSE.md). Hermes Agent is separate MIT-licensed software and
is not bundled here.
