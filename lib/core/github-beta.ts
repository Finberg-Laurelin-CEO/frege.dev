type GitHubBetaOrganization = {
  id: string;
  slug: string;
};

const GITHUB_BETA_ORGS_ENV = "FREGE_GITHUB_CONNECTOR_BETA_ORGS";

function configuredOrganizations(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Private-beta access is fail-closed. Operators must explicitly list an
 * organization UUID or slug; configuring the GitHub App alone never enables
 * connector access for every customer.
 */
export function githubConnectorBetaEnabledFor(
  organization: GitHubBetaOrganization,
  configuredValue: string | undefined = process.env[GITHUB_BETA_ORGS_ENV],
): boolean {
  const allowed = configuredOrganizations(configuredValue);
  return allowed.has(organization.id.toLowerCase()) || allowed.has(organization.slug.toLowerCase());
}

export function assertGitHubConnectorBetaAccess(
  organization: GitHubBetaOrganization,
): Response | null {
  if (githubConnectorBetaEnabledFor(organization)) return null;
  return Response.json(
    {
      error: "github_connector_beta_not_enabled",
      message: "The governed GitHub connector is currently available to invited organizations.",
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
