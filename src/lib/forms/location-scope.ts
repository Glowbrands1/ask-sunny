import "server-only";

import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * WHICH SALON A FORM MAY BE WRITTEN AGAINST
 * ============================================================================
 *
 * THE GAP THIS CLOSES. `POST /api/forms/instances` accepted `locationId` and
 * `locationName` from the request and stored them unchecked. The authenticated
 * identity carried an `AccessScope` the whole time — `authorizeForms` simply
 * dropped it — so nothing compared the salon on a disciplinary record against
 * the salons the person filing it actually covers.
 *
 * ============================================================================
 * WHY DISTRICT AND REGIONAL ACTORS FAIL CLOSED
 * ============================================================================
 *
 * A salon-scoped manager's authorized set is knowable from authenticated data
 * alone: their primary area plus the areas they also cover ARE salon ids.
 *
 * A district manager's `primaryAreaId` is a DISTRICT id, and nothing in this
 * system maps a district to its salons — there is no salon roster table, and
 * `DEMO_LOCATIONS` is a seeded demo file, not an authority. So for a district or
 * regional actor the question "is this salon in your district?" currently has no
 * truthful answer.
 *
 * The honest options were to accept it and record that it was unverified, or to
 * refuse. THIS REFUSES. An accepted-but-unverified salon on an HR record reads
 * exactly like a verified one to everybody who opens it later, and the record
 * outlives the caveat. A refusal is visible today and fixable by connecting a
 * roster; a wrong salon on a disciplinary document is neither.
 *
 * THE COST IS REAL AND IS NOT HIDDEN: until a roster exists, a district or
 * regional manager cannot create a form that names a salon. They can still ask
 * Sunny anything, and a salon-scoped manager is unaffected.
 *
 * ============================================================================
 * DEMO MODE IS NOT A SECURITY CONTROL
 * ============================================================================
 *
 * A demo actor has no verified identity and therefore no scope. Enforcing
 * against a scope the browser asserted about itself would be theatre, and would
 * break preview QA for nothing. `null` scope means "not enforced", and the demo
 * screens already carry the standing notice that says so.
 */

/** Salon ids an authenticated scope proves membership of. */
export function authorizedSalonIds(scope: AccessScope): string[] {
  if (scope.level !== "salon") return [];
  const ids = [scope.primaryAreaId, ...scope.alsoCoversAreaIds].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return [...new Set(ids)];
}

export type LocationAuthorization =
  /** Verified: this actor may file against this salon. */
  | { kind: "authorized"; locationId: string }
  /** No location was requested. Nothing to authorize; the form carries none. */
  | { kind: "no_location" }
  /** Requested a salon this actor's scope does not prove membership of. */
  | { kind: "refused"; reason: string };

/**
 * The one decision every form-creating path must make.
 *
 * @param scope `null` for an unverified (demo) actor — not enforced, see above.
 */
export function authorizeLocation(
  scope: AccessScope | null,
  requestedLocationId: string | null | undefined,
): LocationAuthorization {
  const requested = requestedLocationId?.trim() || null;

  // Nothing was asked for, so there is nothing to refuse. A form with no salon
  // is a form with no salon — that is a product decision, not a bypass.
  if (!requested) return { kind: "no_location" };

  // Demo: unverified identity, no scope, no enforcement.
  if (!scope) return { kind: "authorized", locationId: requested };

  if (scope.level === "global") {
    /*
     * A global actor is not restricted BY SCOPE — that is what global means.
     * This is not a claim that the id names a real salon: there is no roster to
     * check it against. It is a claim that this actor's scope does not exclude
     * it.
     */
    return { kind: "authorized", locationId: requested };
  }

  if (scope.level === "salon") {
    const allowed = authorizedSalonIds(scope);
    if (allowed.includes(requested)) return { kind: "authorized", locationId: requested };
    return {
      kind: "refused",
      // Never echoes the requested id — it came from the caller and naming it
      // back confirms nothing useful while making the message noisier.
      reason:
        "That salon is not one you are assigned to. A form can only be filed against a salon on your own assignment.",
    };
  }

  // district | region — see the note above.
  return {
    kind: "refused",
    reason:
      "Ask Sunny cannot yet verify which salons are in your district, so it will not file a form against one. This needs the salon roster to be connected.",
  };
}

export type LocationProposal =
  /** Exactly one authorized salon, so it can be filled in without guessing. */
  | { resolution: "resolved"; locationId: string }
  /**
   * The manager picks; Sunny does not.
   *
   * `authorizedIds` EMPTY MEANS "NOT ENUMERABLE", not "none": a global actor is
   * restricted by nothing and belongs to no salon list. A salon-scoped actor
   * with no assignment is `unavailable` instead, so the two never collide.
   */
  | { resolution: "needs_selection"; authorizedIds: string[] }
  /** No authoritative answer is available for this actor yet. */
  | { resolution: "unavailable"; reason: string };

/**
 * What chat may fill in on a proposal, before anything is created.
 *
 * DELIBERATELY NARROWER THAN `authorizeLocation`. That one answers "may this
 * actor file here?"; this one answers "can Sunny fill this in without guessing?"
 * — and the answer is only yes when exactly one salon is authorized. Two
 * authorized salons is a question for the manager, not a coin toss on an HR
 * record.
 */
export function proposeLocation(scope: AccessScope | null): LocationProposal {
  if (!scope) {
    return {
      resolution: "unavailable",
      reason: "Preview mode cannot verify a salon, so no location is filled in.",
    };
  }

  if (scope.level === "salon") {
    const allowed = authorizedSalonIds(scope);
    if (allowed.length === 1) return { resolution: "resolved", locationId: allowed[0]! };
    if (allowed.length > 1) return { resolution: "needs_selection", authorizedIds: allowed };
    return {
      resolution: "unavailable",
      reason: "Your account has no salon assigned yet, so Ask Sunny cannot fill one in.",
    };
  }

  if (scope.level === "global") {
    /*
     * Not restricted, and not a salon either. There is nothing authoritative to
     * fill in, and inventing one would put a fictional salon on a real record.
     */
    return {
      resolution: "needs_selection",
      authorizedIds: [],
    };
  }

  return {
    resolution: "unavailable",
    reason:
      "Ask Sunny can't verify the salon for your district yet. Choose a verified salon once the location roster is connected.",
  };
}
