const V2_PREVIEW_ENV = "FREGE_V2_PREVIEW_ENABLED";

export function v2PreviewEnabled(
  configuredValue: string | undefined = process.env[V2_PREVIEW_ENV],
): boolean {
  return configuredValue === "true";
}

export function v2PreviewDisabledResponse(): Response {
  return Response.json(
    {
      error: "v2_preview_disabled",
      message: "The V2 technical preview is not enabled for this deployment.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
