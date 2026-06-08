# Frege

The semantic brain for your company. Make institutional knowledge executable.

Frege is a secure markdown knowledge layer for companies that need AI agents and employees to use the same trusted context without exposing everything. It gives teams one controlled place to read, write, version, and audit institutional knowledge through role-based access controls and MCP-native tools.

## The Problem

Companies are adopting agents faster than they are standardizing the memory layer those agents need.

Today, teams keep rebuilding the same internal infrastructure:

- A markdown folder or private context server for one agent harness.
- A different setup for Codex, Claude Code, OpenRouter, Cursor, or an internal agent.
- Ad hoc rules about which files an agent can read.
- No shared audit trail for who or what accessed company context.
- No clean way to track usage, model calls, storage, and cost by user or org.

The issue is not that markdown files are hard. The issue is that institutional context becomes unsafe, fragmented, and expensive to maintain when every team invents its own agent-readable memory layer.

## What We Are Building

Frege turns institutional knowledge into permission-aware infrastructure.

The first product is a managed knowledge layer where:

- Companies create orgs, departments, roles, users, and API keys.
- Markdown documents are stored as versioned institutional knowledge.
- Role-based access control decides what each person or agent can list, read, draft, update, or administer.
- Agents access approved context through MCP tools.
- Admins can see audit logs, usage, and estimated cost by user, key, and org.

The customer-facing product should be model agnostic. A company should be able to use Codex, Claude Code, OpenRouter, internal agents, and future MCP-capable tools against the same controlled knowledge layer.

## Public Positioning

Primary language:

> The semantic brain for your company.

Alternate:

> Make institutional knowledge executable.

Supporting language:

> Stop rebuilding internal context servers for every agent stack. Frege turns markdown files into secure, versioned, permission-aware tools for Codex, Claude Code, OpenRouter, and internal agents.

Short description:

> A secure markdown knowledge layer that lets companies give agents the right context with role-based access, version history, API keys, audit logs, and usage tracking.

## MVP

The MVP should prove demand before building the full platform.

Initial scope:

- Single-page public landing site at `frege.dev`.
- Signup form for qualified early-access leads.
- Postgres-backed signup storage.
- Lead scoring based on urgency, expected users, agent stack, and willingness to join a pilot.
- Basic product narrative around secure agent-readable institutional memory.

Product scope after validation:

- Org and user onboarding.
- Department and role management.
- API keys for users, agents, and orgs.
- Markdown document CRUD.
- Versioned blob storage for markdown revisions.
- Postgres metadata for document pointers, access rules, users, and audit logs.
- MCP tools for document search, read, propose edit, and update.
- Usage and cost tracking per user and org.

## Not MVP

These are later capabilities, not the first build:

- Email bridge.
- Adcopy generation.
- Public-facing content publishing.
- Broad external MCP orchestration.
- Full enterprise SSO.
- Complex approval workflows.
- General-purpose agent automation.

The first job is to validate that companies want a managed, permission-aware memory layer for agents.

## Signup Form

The public site should collect enough data to validate demand and estimate serving cost.

Required fields:

- Name.
- Work email.
- Company.
- Role.
- Company size.
- Expected number of users.
- Current agent tools.
- Monthly AI/tool spend.
- Decision timeline.
- Main pain point.
- Permission to contact.

The form should not collect confidential company documents or API keys.

## Data Pathway

Signup flow:

1. Visitor submits the landing page form.
2. Frontend validates required fields.
3. TypeScript backend validates the payload again.
4. Backend applies basic spam and rate-limit checks.
5. Backend writes the signup to Postgres.
6. Lead is scored for qualification.
7. High-scoring leads get discovery outreach.
8. Interview notes and aggregate metrics inform pricing, product scope, and investor materials.

Postgres should be the source of truth. Spreadsheet exports are fine for operations, but not as the canonical database.

## Backend Direction

The backend should be TypeScript.

For the validation site, Vercel is a reasonable hosting target. Current Vercel storage guidance supports Postgres through Vercel Marketplace integrations such as Neon, Supabase, or AWS Aurora Postgres. The app should depend on a normal `DATABASE_URL` instead of hard-coding a database vendor.

Expected stack for the first implementation branch:

- Next.js or another Vercel-ready TypeScript web framework.
- Server-side signup endpoint.
- Managed Postgres via `DATABASE_URL`.
- Basic validation and rate limiting.
- Private environment variables for database credentials.

## Branch Plan

Planning branches:

- `plan/product-build`
- `plan/public-language`
- `plan/signup-data-pathways`
- `plan/website-design`

Implementation branches:

- `feature/landing-page`
- `feature/signup-form`
- `feature/signup-api`
- `feature/signup-database`
- `feature/lead-scoring`

Build the public site first, then the signup backend, then the internal lead workflow.

## Validation Milestone

The first target is 200 qualified signups.

Qualified means the company:

- Already uses or is actively evaluating AI agents.
- Has a real company-context problem.
- Cares about access control or sensitive data boundaries.
- Can name a budget owner or internal buyer.
- Would consider a paid pilot if the product solves the problem.

That evidence should come before building the full Frege platform.
