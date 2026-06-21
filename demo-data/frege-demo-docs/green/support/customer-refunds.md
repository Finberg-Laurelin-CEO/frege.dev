# Customer Refund Playbook

Frege agents should build context before answering refund questions. Use this playbook for routine customer refund requests when the account is active and the ticket includes an order ID.

## Standard Refund Path

1. Confirm the order ID and the customer email from the ticket.
2. Check whether the refund is within the standard 30 day policy window.
3. If the request is inside policy, approve the refund and add a short note to the customer timeline.
4. If the request is outside policy, route to the pricing exceptions workflow in `sales-pricing-exceptions`.

## Agent Notes

Agents can summarize this document for support staff, but should cite the document slug and avoid inventing exceptions. If context reports denied sources, mention that additional restricted material exists without naming it.
