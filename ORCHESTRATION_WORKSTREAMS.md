# Frege Workstream Orchestration

This repo uses dedicated feature branches for parallel work. Each branch should read its root-level plan file first, then implement only that scope.

## Branches

| Branch | Plan file | Purpose |
| --- | --- | --- |
| `feature/admin-subdomain-shell` | `ADMIN_SUBDOMAIN_SHELL_PLAN.md` | Admin app shell, no public nav, `admin.frege.dev` readiness |
| `feature/user-auth-api-keys` | `USER_AUTH_API_KEYS_PLAN.md` | User sign-in, invite acceptance, user API key verification |
| `feature/stripe-revenue-visibility` | `STRIPE_REVENUE_VISIBILITY_PLAN.md` | Stripe revenue, payments visibility, signup-to-paid tracking |
| `feature/admin-panel-ux` | `ADMIN_PANEL_UX_PLAN.md` | Platform console UX and operator polish |
| `feature/public-value-prop` | `PUBLIC_VALUE_PROP_PLAN.md` | Public site value prop, pricing/signup copy, proof/demo |

## Recommended integration order

1. `feature/admin-subdomain-shell`
2. `feature/user-auth-api-keys`
3. `feature/stripe-revenue-visibility`
4. `feature/admin-panel-ux`
5. `feature/public-value-prop`

## Agent rules

- Start from the named branch, not `main`.
- Read the plan file before editing.
- Keep changes inside the branch scope.
- Run `pnpm typecheck` and `pnpm build` before reporting done.
- Do not commit secrets.
- Do not change public pricing numbers unless the plan explicitly calls for it.
- Manual dashboard steps belong in the final report, not in code.
