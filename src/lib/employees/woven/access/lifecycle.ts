import type { AccessAction, LifecycleOutcome, PlannedRow } from "./types";

/**
 * ============================================================================
 * THE ACCOUNT LIFECYCLE, READ FROM A PLANNED ROW
 * ============================================================================
 *
 * The planner speaks a detailed vocabulary (about twenty actions and flags).
 * The account lifecycle — the only thing this sync is allowed to apply — needs
 * five words, and the Access Preview leads with them:
 *
 *   CREATE_USER         create the account and send the Supabase invitation
 *   LINK_EXISTING       store the EmployeeID link for one exact email match
 *   DISABLE_TERMINATED  Woven says Terminated: disable, ban, revoke sessions
 *   REVIEW_REQUIRED     something blocks the lifecycle and a person must look
 *   NO_CHANGE           nothing for the lifecycle to do
 *
 * Pure. Each outcome carries ONE reason code, the planner's own where there is
 * one. Role and location differences are deliberately NOT lifecycle reviews:
 * this sync never changes a role or a salon, so they read as NO_CHANGE here
 * (their detailed flags are still on the row).
 */

/** Automatic invitation attempts before a provisioned account is handed to a person. */
export const MAX_AUTOMATIC_INVITE_ATTEMPTS = 3;

/** Flags on a LINKED account that a person must look at. */
const LINKED_REVIEW: readonly AccessAction[] = [
  "FLAG_REHIRE_REVIEW",
  "FLAG_STATUS_CONFLICT",
  "FLAG_EMAIL_CHANGE_REVIEW",
  "FLAG_UNKNOWN_STATUS",
  "FLAG_MISSING_FROM_WOVEN",
];

/** Flags on an employee WITHOUT an account that stop an account being created. */
const CREATE_BLOCKERS: readonly AccessAction[] = [
  "FLAG_DUPLICATE_EMAIL",
  "FLAG_STATUS_CONFLICT",
  "FLAG_UNMAPPED_POSITION",
  "FLAG_UNMAPPED_LOCATION",
  "FLAG_MISSING_EMAIL",
];

const AUTO_ROLES = ["salon_director", "assistant_salon_director"];

const code = (action: AccessAction) => action.replace(/^FLAG_/, "").toLowerCase();

export function lifecycleOf(row: Omit<PlannedRow, "lifecycle" | "lifecycleReason">): { lifecycle: LifecycleOutcome; lifecycleReason: string } {
  const has = (action: AccessAction) => row.actions.includes(action);
  const out = (lifecycle: LifecycleOutcome, lifecycleReason: string) => ({ lifecycle, lifecycleReason });
  const firstReason = row.reasons[0] ?? "in_sync_with_woven";

  if (has("DISABLE_TERMINATED")) {
    return out("DISABLE_TERMINATED", row.account?.status === "disabled" ? "terminated_in_woven_completing_revocation" : "terminated_in_woven");
  }
  if (has("CREATE_USER")) return out("CREATE_USER", "eligible_salon_manager_without_account");
  if (has("LINK_EXISTING")) return out("LINK_EXISTING", "single_exact_email_match");

  const via = row.account?.via ?? null;

  if (via === "link") {
    const review = LINKED_REVIEW.find(has);
    if (review) return out("REVIEW_REQUIRED", row.reasons.find((r) => r !== "woven_shows_past_termination_date") ?? code(review));
    if (has("FLAG_PROTECTED_ACCOUNT") && row.reasons.some((r) => r.startsWith("terminated_in_woven"))) {
      return out("REVIEW_REQUIRED", row.reasons.find((r) => r.startsWith("terminated_in_woven"))!);
    }
    const invite = row.account?.invite;
    if (row.account?.status === "invited" && invite?.status === "failed" && invite.attempts >= MAX_AUTOMATIC_INVITE_ATTEMPTS) {
      return out("REVIEW_REQUIRED", "invite_delivery_failed");
    }
    if (has("UPDATE_ROLE") || has("UPDATE_PRIMARY_LOCATION") || has("FLAG_ROLE_REVIEW") || has("FLAG_LOCATION_REVIEW")) {
      return out("NO_CHANGE", "role_and_location_not_managed_by_lifecycle");
    }
    return out("NO_CHANGE", firstReason);
  }

  if (via === "account_only") {
    if (has("FLAG_LINKED_EMPLOYEE_NOT_FOUND")) return out("REVIEW_REQUIRED", "linked_employee_not_in_woven_directory");
    return out("NO_CHANGE", firstReason);
  }

  if (via === "email_candidate") {
    /* An email that names an account but could not be linked automatically. */
    const onlyNotManaged = row.actions.every((a) => a === "FLAG_NOT_WOVEN_MANAGED");
    if (onlyNotManaged) {
      const wouldProvision = row.wovenStatus === "active" && row.proposedRole !== null && AUTO_ROLES.includes(row.proposedRole);
      return wouldProvision ? out("REVIEW_REQUIRED", "email_in_use_by_account_marked_not_woven_managed") : out("NO_CHANGE", "email_matches_account_marked_not_woven_managed");
    }
    return out("REVIEW_REQUIRED", row.reasons.find((r) => r !== "woven_shows_past_termination_date") ?? firstReason);
  }

  /* No account at all. */
  const blocker = CREATE_BLOCKERS.find(has);
  if (blocker) return out("REVIEW_REQUIRED", has("FLAG_STATUS_CONFLICT") ? "woven_shows_past_termination_date" : (row.reasons[0] ?? code(blocker)));
  return out("NO_CHANGE", firstReason);
}

export function countLifecycle(rows: readonly PlannedRow[]): Record<LifecycleOutcome, number> {
  const counts: Record<LifecycleOutcome, number> = { CREATE_USER: 0, LINK_EXISTING: 0, NO_CHANGE: 0, DISABLE_TERMINATED: 0, REVIEW_REQUIRED: 0 };
  for (const row of rows) counts[row.lifecycle] += 1;
  return counts;
}
