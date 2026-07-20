# Frege Agent Profile

This directory is a minimal Hermes profile distribution for running a local
agent with Frege as its governed organizational-memory layer.

It deliberately contains no model choice, provider credentials, hosted agent
runtime, gateway, or scheduled work. Hermes and the user's selected model run
on user-controlled compute. `frege mcp serve` supplies the local stdio bridge to
the hosted Frege API.

## Install

Prerequisites:

- Hermes Agent 0.16.0 or newer
- Node.js 20 or newer
- A `frege` CLI on `PATH`
- A valid Frege connection already saved with `frege connect`

Install the published Frege CLI, connect it to your organization, and ask it
to install this profile:

```bash
npm install -g @frege-dev/cli
frege connect https://frege.dev --token "$FREGE_API_KEY" --no-register
frege doctor
frege agent install hermes
```

Then choose the model and tools you want Hermes to use:

```bash
frege-agent setup
frege-agent mcp test frege
frege-agent chat
```

The equivalent direct Hermes installation is:

```bash
hermes profile install github.com/Finberg-Laurelin-CEO/frege-agent --alias
```

## Local development

From the Frege repository:

```bash
cd packages/frege-cli
npm link

frege connect https://frege.dev --token "$FREGE_API_KEY" --no-register
frege doctor

cd ../..
hermes profile install ./packages/frege-agent-profile --alias
frege-agent setup
frege-agent mcp test frege
frege-agent chat
```

`frege connect` stores the Frege connection in the user's existing local Frege
configuration. This profile does not duplicate the API key in Hermes
`config.yaml`, `.env`, or the distribution.

The profile disables Hermes' built-in persistent-memory toolset so there is one
canonical organizational-memory system. Hermes may still retain local session
history; only information explicitly sent through a Frege tool enters Frege.

## Safe defaults

- Governed reads, selective session events, and reviewable proposals are
  enabled.
- Direct canonical document creation is excluded from the default MCP tool
  allowlist.
- No cron jobs are included.
- No model or provider is selected.
- No credentials are included.

This distribution is source-visible proprietary preview software. See
`LICENSE.md`. Hermes Agent is a separate MIT-licensed project and is not bundled
in this distribution.
