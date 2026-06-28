const FREE_CODE_MIGRATION_MESSAGE =
  "Free activation code storage is not configured for this deployment. Apply db/015_free_activation_codes.sql with pnpm db:migrate, then reload /platform.";

export function isFreeCodeSchemaError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? "");

  if (code === "42P01" || code === "42703") return true;

  return (
    message.includes("free_activation_codes") ||
    message.includes("entitlement_kind") ||
    message.includes("comp_activation_code_id")
  );
}

export function freeCodeSchemaResponse(label: string, err: unknown): Response | null {
  if (!isFreeCodeSchemaError(err)) return null;

  console.error(label, {
    code: (err as { code?: string })?.code,
    message: (err as { message?: string })?.message,
  });

  return Response.json(
    {
      error: "free_codes_not_configured",
      message: FREE_CODE_MIGRATION_MESSAGE,
    },
    { status: 503 },
  );
}
