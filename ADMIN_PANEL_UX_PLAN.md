# Admin Panel UX Plan

Branch: `feature/admin-panel-ux`

## Goal
Make the admin panel easier to operate day-to-day after the underlying admin Auth0 and revenue/user flows are reliable.

Focus on information architecture, visibility, safe actions, and operator speed. Do not add broad new backend features in this branch unless needed for a small UX improvement.

## Current state

Relevant files:

- Platform page: `app/platform/page.tsx`
- Platform console UI: `app/platform/PlatformConsole.tsx`
- Shared admin styles: `app/admin/admin.module.css`
- Platform APIs: `app/api/v1/platform/**/*`
- Org admin UI: `app/admin/AdminConsole.tsx`

Current platform console has tabs for action queue, orgs, users, approvals, usage, payments, and audit. It is functional but table-heavy and has limited at-a-glance summary.

## Implementation steps

1. **Add an operator summary header**
   - At top of `/platform`, show compact cards for:
     - action queue count
     - pending approvals
     - active orgs
     - past-due subscriptions or payment issues
     - recent audit/action count if available
   - Use data already loaded where possible.

2. **Improve tab labels and hierarchy**
   - Use clearer labels: Queue, Organizations, Users, Approvals, Usage, Payments, Audit.
   - Show counts on tab labels where cheap and already loaded.

3. **Improve table readability**
   - Add empty states for each tab.
   - Use badges/classes for status values (`active`, `inactive`, `suspended`, `past_due`, `refunded`, etc.).
   - Keep dangerous actions visually secondary and confirm before mutation.

4. **Improve org detail drawer/panel**
   - Organize detail into sections:
     - Billing
     - Members
     - API keys
     - 30-day usage
   - Add clear close button and loading state.
   - Avoid layout jump where possible.

5. **Improve payments/admin action clarity**
   - Make refund/cancel actions explicit and confirmed.
   - Include IDs/prefixes where useful for support, but avoid clutter.

6. **Responsive polish**
   - Ensure tables do not break the page at narrower widths.
   - Prefer horizontal scroll wrappers over crushed columns.

## Verification

Run:

```bash
pnpm typecheck
pnpm build
```

Manual checks:

- `/platform` loads without console errors.
- All existing tabs still load their data.
- Search still filters orgs/users.
- Opening/closing org detail still works.
- Mutating actions still call the same endpoints and refresh relevant data.
- No public marketing nav or shell concerns are addressed here; that belongs in `feature/admin-subdomain-shell`.

## Out of scope

- Do not change Auth0 or domain routing here.
- Do not add Stripe revenue APIs here; consume them if already provided by `feature/stripe-revenue-visibility`.
- Do not change user sign-in or API key backend behavior here.
