const HOSTED_EXECUTION_ENV = "FREGE_HOSTED_EXECUTION_ENABLED";

/**
 * Frege's MVP is a governed memory and context service for agents that run on
 * the customer's machine. Hosted model and agent execution stays dormant until
 * it is deliberately enabled for a future private beta.
 */
export function hostedExecutionEnabled(
  configuredValue: string | undefined = process.env[HOSTED_EXECUTION_ENV],
): boolean {
  return configuredValue === "true";
}

export function hostedExecutionDisabledResponse(): Response {
  return Response.json(
    {
      error: "hosted_execution_disabled",
      message:
        "Run the agent in your own client and use Frege through MCP or the API for governed context and memory.",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
