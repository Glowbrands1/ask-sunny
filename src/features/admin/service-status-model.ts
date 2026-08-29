/**
 * Pure mapping from health data to what the admin panel renders.
 *
 * Extracted from the component so the decisions that matter — when a service
 * reads as a problem, when "not configured" is alarming versus expected — are
 * testable without a DOM, and so the rules live in one place rather than being
 * spread across JSX conditionals.
 */

export type ServiceTone = "ready" | "attention" | "failed" | "neutral";

export interface ServiceRowState {
  tone: ServiceTone;
  label: string;
}

export function serviceRowState(input: {
  configured: boolean;
  /** True when this deployment actually needs the service now. */
  required: boolean;
  /** Set when something is actively wrong, as opposed to merely absent. */
  problem?: string;
}): ServiceRowState {
  // A problem outranks everything: a service that is configured WRONG is worse
  // than one that is simply missing, because it looks fine from a distance.
  if (input.problem) return { tone: "failed", label: "Problem" };
  if (input.configured) return { tone: "ready", label: "Configured" };
  // Unconfigured is only alarming when the deployment needs it. In demo mode
  // nothing is required, and painting the whole page amber would be noise.
  if (input.required) return { tone: "attention", label: "Required" };
  return { tone: "neutral", label: "Not needed yet" };
}

/** The mode badge. Demo and live mean different things about answer validity. */
export function modeBadge(mode: "demo" | "live"): {
  tone: "accent" | "processing";
  label: string;
} {
  return mode === "live"
    ? { tone: "accent", label: "Live mode" }
    : { tone: "processing", label: "Demo mode" };
}

/**
 * Guards the one thing this screen must never do.
 *
 * The health payload carries variable names only, so a value cannot reach the
 * UI — but this asserts the invariant rather than trusting it, and is used by
 * the test suite to check the real payload shape.
 */
export function containsNoSecretValues(payload: unknown, secrets: string[]): boolean {
  const serialized = JSON.stringify(payload ?? {});
  return !secrets.some((secret) => secret.length > 0 && serialized.includes(secret));
}
