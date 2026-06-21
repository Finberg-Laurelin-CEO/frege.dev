# Pricing Exceptions Workflow

Pricing exceptions handle renewal discounts, plan migrations, account credits, and refund requests outside the standard support policy. The support playbook `support-customer-refunds` links here when the request is outside the routine path.

## Approval Rules

- Support can request an exception but cannot approve it.
- Sales operations can approve account credits up to the published pilot limit.
- Finance review is required for multi-month credits or contract amendments.
- Restricted escalation data may exist, but agents with standard keys should rely only on visible Frege context.

## Telemetry Expectations

Every exception summary should include the actor, account identifier, action, outcome, and request ID. Do not put payment card data or raw customer secrets into telemetry metadata.
