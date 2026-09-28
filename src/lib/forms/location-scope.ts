import "server-only";

import { PRODUCTION_SALONS, salonById, type ProductionSalon } from "@/data/salons";
import { storeNameKey } from "@/lib/reporting/store-identity";
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
 * `PRODUCTION_SALONS` is the roster, not a per-record authority. So for a district or
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
  /**
   * This actor has no salon assignment to fill in, and does not need one.
   *
   * DISTINCT FROM `unavailable`, which means "the answer exists and cannot be
   * verified". A global actor is not assigned to a salon at all, and
   * `authorizeLocation` already permits them a form without one — so blocking
   * them would be inventing a requirement the server does not have.
   */
  | { resolution: "not_applicable"; reason: string }
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
     * ========================================================================
     * NOT RESTRICTED, AND NOT ASSIGNED TO A SALON EITHER
     * ========================================================================
     *
     * THIS RETURNED `needs_selection` WITH AN EMPTY LIST, and that one line
     * made the entire inline-creation feature unreachable for the only kind of
     * account that exists on the live project. `needs_selection` means the
     * proposal is not `ready`, `ready` is what gates "Create draft", so an
     * administrator asking for a coaching form got a card with no action, the
     * "use Create a Form instead" escape copy, and a question about a salon
     * they could not answer — with nothing to pick from.
     *
     * The mistake was treating "no salon to fill in" as "a missing answer". For
     * a global actor it is neither missing nor unverifiable: they are not
     * assigned to a salon, and `authorizeLocation` already lets them file a
     * form that names none. Demanding one invents a requirement the server does
     * not have.
     *
     * So the form is created WITHOUT a salon and the card says so plainly. What
     * is still refused is INVENTING one — there is no roster, and a fictional
     * salon on a disciplinary record is the thing this workstream exists to
     * stop.
     */
    return {
      resolution: "not_applicable",
      reason:
        "Your account covers every salon rather than one, so Ask Sunny will not put a salon on this form.",
    };
  }

  return {
    resolution: "unavailable",
    reason:
      "Ask Sunny can't verify the salon for your district yet. Choose a verified salon once the location roster is connected.",
  };
}

/**
 * ============================================================================
 * A SALON THE MANAGER NAMED — BUT ONLY ONE THEY MAY FILE AGAINST
 * ============================================================================
 *
 * "Exit form for Jane, she worked at lincoln o street" names a salon, and for a
 * manager assigned to several that is the answer to "which salon?" they would
 * otherwise be asked. The name is matched against the PRODUCTION ROSTER through
 * `storeNameKey` — the reporting layer's own normaliser, so case, full stops
 * and "&" / "and" do not matter — and only against the salons THIS ACTOR IS
 * AUTHORIZED FOR. A salon outside their scope is never proposed, whatever they
 * type, and `authorizeLocation` re-checks the id on create regardless.
 *
 * THE FULL STORE NAME MATCHES ANYWHERE; THE NAME WITHOUT ITS STATE PREFIX
 * ("Lincoln O Street" for "NE Lincoln O Street") MATCHES ONLY WHERE THE WORDS
 * SAY IT IS A PLACE — after "at", "in" or "from", or before "salon", "store" or
 * "location". "Lawrence" is a salon and a first name, and "exit form for
 * Lawrence Smith" must not put the form at KS Lawrence.
 *
 * EXACTLY ONE, OR NOTHING. Two salons named is a question for the manager.
 */
export function salonsNamedIn(
  text: string,
  candidates: readonly ProductionSalon[],
): ProductionSalon[] {
  const said = ` ${storeNameKey(text)} `;
  return candidates.filter((salon) => {
    const full = storeNameKey(salon.name);
    if (said.includes(` ${full} `)) return true;
    const short = full.replace(/^[a-z]{2} /, "");
    const escaped = short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:\\b(?:at|in|from)(?: the)? ${escaped}\\b)|(?:\\b${escaped} (?:salon|store|location)\\b)`,
    ).test(said);
  });
}

/**
 * The location proposal, settled by a salon the manager named where the scope
 * alone could not settle it.
 *
 * ONLY TWO CASES CHANGE. A manager assigned to several salons who names one of
 * them, and a global actor — restricted by no salon — who names one. Every
 * other case is returned untouched: a single assigned salon is already
 * resolved, and a district, region or preview actor still cannot have a salon
 * verified, so naming one changes nothing.
 */
export function proposeLocationFromConversation(
  scope: AccessScope | null,
  text: string,
): LocationProposal {
  const base = proposeLocation(scope);
  const candidates =
    base.resolution === "needs_selection" && base.authorizedIds.length > 0
      ? base.authorizedIds
          .map((id) => salonById(id))
          .filter((salon): salon is ProductionSalon => salon !== undefined)
      : base.resolution === "not_applicable" && scope?.level === "global"
        ? [...PRODUCTION_SALONS]
        : [];
  if (candidates.length === 0) return base;
  const named = salonsNamedIn(text, candidates);
  return named.length === 1 ? { resolution: "resolved", locationId: named[0]!.id } : base;
}
