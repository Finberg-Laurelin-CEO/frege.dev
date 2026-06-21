# Restricted Red Zone Handling

This is synthetic restricted data for local Frege testing. It exists only to verify that reader and writer keys can see a denied count without receiving restricted titles or document bodies.

## Rules

- Red-zone material cannot route to providers that are not explicitly approved for red trust-zone work.
- Standard agent keys should receive denied summaries only.
- Admins can review restricted data when their role includes the restricted label.
- Telemetry should record the trust zone, outcome, and request ID without logging full restricted text.
