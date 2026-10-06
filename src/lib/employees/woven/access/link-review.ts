
import { allowedManagedFlags } from "./managed-policy";
import type { PlannedRow } from "./types";

/**
 * ============================================================================
 * LINK REVIEW — a person confirms "this Ask Sunny account IS that Woven
 * employee", and from then on the EmployeeID, never the email, identifies it
 * ============================================================================
 *
 * Pure. The caller supplies the CURRENT plan; a review is accepted only for a
 * row the planner itself proposes for review right now — an exact,
 * case-insensitive email match between exactly one Woven employee and exactly
 * one UNCLASSIFIED account (`FLAG_LINK_REVIEW`, account via `email_candidate`).
 * So a stale screen, a hand-made request or an ambiguous match is refused,
 * whatever the browser sends.
 *
 * Two outcomes, both explicit and durable:
 *
 *   confirm             woven_linked, external_employee_id = that EmployeeID,
 *                       link_method admin_confirmed_email. The account is no
 *                       longer matched by email: the planner finds it by the
 *                       EmployeeID first, and only ever proposes links for
 *                       UNCLASSIFIED accounts.
 *   not_woven_managed   the match is a coincidence: the account is marked not
 *                       managed by Woven, and no Woven action ever touches it.
 *
 * WHAT WOVEN MAY MANAGE IS OPT-IN, PER FIELD, AND BOUNDED by the owner's
 * policy in `managed-policy.ts`:
 *   - status:   never for an administrative or protected account;
 *   - location and role: only for a salon-tier account (employee, assistant
 *     salon director, salon director) whose scope is a single salon. For
 *     anyone else the flags are stored OFF whatever is asked.
 * All three default OFF. Linking changes nobody's access by itself.
 */

export type LinkDecision = "confirm" | "not_woven_managed";

export interface LinkReviewInput {
  appUserId: string;
  externalEmployeeId: string;
  decision: LinkDecision;
  managedStatus: boolean;
  managedLocation: boolean;
  managedRole: boolean;
}

export class LinkReviewError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_pending" | "already_linked",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LinkReviewError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPLOYEE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function parseLinkReview(body: Record<string, unknown> | null): LinkReviewInput {
  const b = body ?? {};
  if (typeof b.appUserId !== "string" || !UUID.test(b.appUserId)) throw new LinkReviewError("invalid_input", "appUserId must be an account id.", 400);
  if (typeof b.externalEmployeeId !== "string" || !EMPLOYEE_ID.test(b.externalEmployeeId)) {
    throw new LinkReviewError("invalid_input", "externalEmployeeId must be a Woven EmployeeID.", 400);
  }
  if (b.decision !== "confirm" && b.decision !== "not_woven_managed") {
    throw new LinkReviewError("invalid_input", 'decision must be "confirm" or "not_woven_managed".', 400);
  }
  /* An explicit confirmation is required: a person must tick "this is the same person". */
  if (b.decision === "confirm" && b.samePersonConfirmed !== true) {
    throw new LinkReviewError("invalid_input", "Confirm that this account and this Woven employee are the same person.", 400);
  }
  const flag = (v: unknown) => v === true;
  return {
    appUserId: b.appUserId.toLowerCase(),
    externalEmployeeId: b.externalEmployeeId,
    decision: b.decision,
    managedStatus: flag(b.managedStatus),
    managedLocation: flag(b.managedLocation),
    managedRole: flag(b.managedRole),
  };
}

/** Which managed flags this account may carry at all — the owner's policy, `managed-policy.ts`. */
export { allowedManagedFlags };

/** The pending reviews in a plan: one per FLAG_LINK_REVIEW row. */
export function pendingLinkReviews(rows: readonly PlannedRow[]): PlannedRow[] {
  return rows.filter((r) => r.actions.includes("FLAG_LINK_REVIEW") && r.account?.via === "email_candidate" && r.externalEmployeeId !== null);
}

export interface LinkRowToInsert {
  app_user_id: string;
  management: "woven_linked" | "not_woven_managed";
  external_employee_id: string | null;
  link_method: "admin_confirmed_email" | "admin_manual";
  managed_status: boolean;
  managed_location: boolean;
  managed_role: boolean;
  reason: string;
  set_by: string;
}

/** Decides a review against the current plan. Throws `not_pending` for anything the planner is not proposing right now. */
export function decideLinkReview(rows: readonly PlannedRow[], input: LinkReviewInput, reviewer: string): LinkRowToInsert {
  const row = pendingLinkReviews(rows).find(
    (r) => r.externalEmployeeId === input.externalEmployeeId && r.account?.appUserId === input.appUserId,
  );
  if (!row || !row.account) {
    throw new LinkReviewError(
      "not_pending",
      "That account and Woven employee are not a pending exact-email match. Reload the Access Preview and review again.",
      409,
    );
  }
  if (input.decision === "not_woven_managed") {
    return {
      app_user_id: input.appUserId,
      management: "not_woven_managed",
      external_employee_id: null,
      link_method: "admin_manual",
      managed_status: false,
      managed_location: false,
      managed_role: false,
      reason: `Email match with Woven employee ${input.externalEmployeeId} rejected as a different person`,
      set_by: reviewer,
    };
  }
  const allowed = allowedManagedFlags(row.account, row.account.isProtected);
  return {
    app_user_id: input.appUserId,
    management: "woven_linked",
    external_employee_id: input.externalEmployeeId,
    link_method: "admin_confirmed_email",
    managed_status: input.managedStatus && allowed.status,
    managed_location: input.managedLocation && allowed.location,
    managed_role: input.managedRole && allowed.role,
    reason: "Exact email match confirmed by a person",
    set_by: reviewer,
  };
}
