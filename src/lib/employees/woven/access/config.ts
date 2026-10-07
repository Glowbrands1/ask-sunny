import "server-only";

import { isApplyCapability, type ApplyCapability } from "./types";

/**
 * ============================================================================
 * WOVEN_ACCESS_MODE — what the access sync may do beyond the preview
 * ============================================================================
 *
 *   off     (default) the Access Preview calculates and shows the plan;
 *           nothing is recorded and nothing is applied.
 *   shadow  as off, AND each successful scheduled directory sync records the
 *           plan in `employee_access_runs` / `employee_access_actions`
 *           (result = shadow). Nothing is applied.
 *   apply   each successful scheduled directory sync runs the ACCOUNT
 *           LIFECYCLE (`apply.ts`) — but only the capabilities named in
 *           WOVEN_ACCESS_APPLY_ACTIONS (CREATE_USER, SEND_INVITE,
 *           LINK_EXISTING, DISABLE_TERMINATED), and, while
 *           WOVEN_ACCESS_APPLY_EMPLOYEE_IDS is set, only for those Woven
 *           EmployeeIDs (the controlled first batch). Every row of the plan is
 *           recorded; what was not applied is recorded as planned or skipped.
 *
 * THREE SWITCHES, ALL CLOSED BY DEFAULT. `apply` with no capabilities listed
 * applies nothing. CREATE_USER without SEND_INVITE creates the account
 * (invited, no email sent). A capability that is not one of CREATE_USER,
 * SEND_INVITE, LINK_EXISTING or DISABLE_TERMINATED — UPDATE_ROLE and
 * UPDATE_PRIMARY_LOCATION included —
 * is refused, reported as a problem, and the mode falls back to OFF: a
 * misconfiguration must never widen what runs. Any unknown mode is OFF too.
 *
 *   WOVEN_ACCESS_MODE=apply
 *   WOVEN_ACCESS_APPLY_ACTIONS=CREATE_USER,SEND_INVITE,LINK_EXISTING,DISABLE_TERMINATED
 *   WOVEN_ACCESS_APPLY_EMPLOYEE_IDS=<id>,<id>     (optional; unset = everyone)
 */

export const WOVEN_ACCESS_MODE_ENV = "WOVEN_ACCESS_MODE";
export const WOVEN_ACCESS_APPLY_ACTIONS_ENV = "WOVEN_ACCESS_APPLY_ACTIONS";
export const WOVEN_ACCESS_APPLY_EMPLOYEE_IDS_ENV = "WOVEN_ACCESS_APPLY_EMPLOYEE_IDS";

export type WovenAccessMode = "off" | "shadow" | "apply";

export interface WovenAccessConfig {
  mode: WovenAccessMode;
  /** Only meaningful in apply mode. Empty: nothing is applied. */
  applyActions: ApplyCapability[];
  /** null: every eligible employee. A list: only these EmployeeIDs (the first, controlled batch). */
  employeeAllowlist: string[] | null;
  problem: string | null;
}

const OFF = (problem: string | null): WovenAccessConfig => ({ mode: "off", applyActions: [], employeeAllowlist: null, problem });
const list = (raw: string | undefined) =>
  (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const EMPLOYEE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function readWovenAccessConfig(env: Record<string, string | undefined> = process.env): WovenAccessConfig {
  const raw = (env[WOVEN_ACCESS_MODE_ENV] ?? "").trim().toLowerCase();
  if (raw === "" || raw === "off") return OFF(null);
  if (raw === "shadow") return { mode: "shadow", applyActions: [], employeeAllowlist: null, problem: null };
  if (raw !== "apply") {
    return OFF(`${WOVEN_ACCESS_MODE_ENV} must be "off", "shadow" or "apply". It was treated as off.`);
  }

  const actions = list(env[WOVEN_ACCESS_APPLY_ACTIONS_ENV]).map((a) => a.toUpperCase());
  const refused = actions.filter((a) => !isApplyCapability(a));
  if (refused.length > 0) {
    return OFF(
      `${WOVEN_ACCESS_APPLY_ACTIONS_ENV} may name only CREATE_USER, SEND_INVITE, LINK_EXISTING and DISABLE_TERMINATED; ${refused.join(", ")} is not applied by this sync. Access mode was treated as off.`,
    );
  }

  const ids = list(env[WOVEN_ACCESS_APPLY_EMPLOYEE_IDS_ENV]);
  if (ids.some((id) => !EMPLOYEE_ID.test(id))) {
    return OFF(`${WOVEN_ACCESS_APPLY_EMPLOYEE_IDS_ENV} must be a comma-separated list of Woven EmployeeIDs. Access mode was treated as off.`);
  }

  return {
    mode: "apply",
    applyActions: [...new Set(actions)] as ApplyCapability[],
    employeeAllowlist: ids.length > 0 ? [...new Set(ids)] : null,
    problem: null,
  };
}

/** The mode alone, for callers that only display it. */
export function readWovenAccessMode(env: Record<string, string | undefined> = process.env): { mode: WovenAccessMode; problem: string | null } {
  const { mode, problem } = readWovenAccessConfig(env);
  return { mode, problem };
}
