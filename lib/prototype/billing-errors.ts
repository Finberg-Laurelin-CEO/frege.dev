export function billingSchemaResponse(label: string, err: unknown): Response | null {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? "");
  if (code !== "42P01" && code !== "42703" && !message.includes("org_billing")) return null;

  console.error(label, {
    code,
    message: (err as { message?: string })?.message,
  });

  return Response.json(
    {
      error: "billing_storage_not_configured",
      message: "Billing storage is not configured for this deployment. Apply the billing database migrations.",
    },
    { status: 503 },
  );
}
