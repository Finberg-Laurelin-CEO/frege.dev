# Deploy Rollback Runbook

Use this runbook when a production deploy causes elevated errors, broken login, failed document reads, or missing context packets. The goal is to restore service first, then preserve the evidence needed for telemetry review.

## Rollback Steps

1. Confirm the failing release and request ID from telemetry.
2. Stop new deploys for the affected environment.
3. Roll back to the last passing build.
4. Run health, document list, search, and context build smoke checks.
5. Add a post-rollback note that links to the related audit event.

## Related Workflows

For customer-facing refund impact, read `support-customer-refunds`. For context gateway errors, read `product-context-gateway`.
