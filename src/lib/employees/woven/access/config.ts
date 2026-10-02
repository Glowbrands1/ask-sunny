import "server-only";

/**
 * ============================================================================
 * WOVEN_ACCESS_MODE — what the access planner may do beyond the preview
 * ============================================================================
 *
 *   off     (default) the Access Preview calculates and shows the plan;
 *           nothing is recorded and nothing is applied.
 *   shadow  as off, AND each successful scheduled directory sync records the
 *           plan in `employee_access_runs` / `employee_access_actions`
 *           (result = shadow). Still nothing is applied: no account is
 *           created, no invite sent, no access revoked, no salon or role moved.
 *
 * THERE IS NO APPLY MODE. Any other value — including "apply" — is reported as
 * a problem and treated as off. Applying actions is a later stage that needs
 * its own code and its own approval.
 */

export const WOVEN_ACCESS_MODE_ENV = "WOVEN_ACCESS_MODE";

export type WovenAccessMode = "off" | "shadow";

export function readWovenAccessMode(env: Record<string, string | undefined> = process.env): {
  mode: WovenAccessMode;
  problem: string | null;
} {
  const raw = (env[WOVEN_ACCESS_MODE_ENV] ?? "").trim().toLowerCase();
  if (raw === "" || raw === "off") return { mode: "off", problem: null };
  if (raw === "shadow") return { mode: "shadow", problem: null };
  return {
    mode: "off",
    problem: `${WOVEN_ACCESS_MODE_ENV} must be "off" or "shadow". Applying access changes is not available, so it was treated as off.`,
  };
}
