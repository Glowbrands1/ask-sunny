/**
 * Security warnings surfaced by /api/health.
 *
 * Separate from `configurationProblems`, and the distinction is deliberate:
 *
 *   problem  -> the deployment does not work, and requests are refused.
 *   warning  -> the deployment works but should not be trusted.
 *
 * Collapsing the two would hide the more dangerous category. A deployment
 * serving unauthenticated requests works perfectly; that is exactly what makes
 * it worth shouting about.
 *
 * Pure, so the wording and the conditions are testable without a server.
 */
export interface SecurityWarningInput {
  mode: "demo" | "live";
  authProviderKind: string;
  authIsProductionGrade: boolean;
  /** The bypass is active right now. Only possible outside production. */
  unauthenticatedAccessAllowed: boolean;
  /**
   * The flag is set but this is a production build, so it does nothing.
   * Reported because the operator plainly intended it to work.
   */
  unauthenticatedBypassIgnoredInProduction?: boolean;
  escapeHatchVariableName: string;
}

export function buildSecurityWarnings(input: SecurityWarningInput): string[] {
  const warnings: string[] = [];

  // Demo mode has no server-side surface to protect, so none of the below
  // applies: the routes refuse on mode alone before authorization is reached.
  if (input.mode === "demo") return warnings;

  if (!input.authIsProductionGrade && !input.unauthenticatedAccessAllowed) {
    warnings.push(
      "No production authentication provider is configured, so protected functionality is refused.",
    );
  }

  if (input.unauthenticatedAccessAllowed) {
    warnings.push(
      `${input.escapeHatchVariableName} is enabled. Protected routes are serving unauthenticated requests. This is intended only for a local pre-authentication acceptance test, and it cannot operate in a production build.`,
    );
  }

  if (input.unauthenticatedBypassIgnoredInProduction) {
    // Not a failure — the refusal above is already correct. It is a signal that
    // someone tried to disable authentication on a production deployment.
    warnings.push(
      `${input.escapeHatchVariableName} is set, but this is a production build and the bypass is permanently disabled here. Protected requests are still being refused. Remove the variable.`,
    );
  }

  if (input.authProviderKind === "demo") {
    warnings.push(
      "The demo role switcher is active in live mode. It is a presentation aid, not authentication.",
    );
  }

  return warnings;
}
