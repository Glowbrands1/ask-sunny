import "server-only";

import { AiError } from "@/lib/ai/errors";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isAllowedStoreCode } from "../store-codes";
import type { GoogleListingState } from "../types";
import type { ApifyLocationMapping, ApifySourceStatus, DiscoveryStatus } from "./types";

/**
 * ============================================================================
 * WHICH GOOGLE LISTING EACH SALON IS — resolved once, verified, and persisted
 * ============================================================================
 *
 * ============================================================================
 * WHY A SCHEDULED RUN MUST NEVER SEARCH BY NAME
 * ============================================================================
 *
 * "Sun Tan City" is a franchise brand. A search for it near Omaha returns
 * listings this business does not operate, and a search that drifts one listing
 * sideways files a stranger's reviews against a real salon — permanently, and
 * with nothing on the dashboard looking wrong. It is precisely the failure the
 * store-code mapping exists to prevent, arriving through a different door.
 *
 * So the Google identifier is resolved ONCE, checked against what the roster
 * says the salon is, written down, and used forever after. Every recurring run
 * addresses a listing by an id nobody can typo into a different business.
 *
 * ============================================================================
 * AND WHY AMBIGUITY IS A REFUSAL, NOT A BEST GUESS
 * ============================================================================
 *
 * `verifyPlaceCandidate` returns `rejected` when the evidence does not line up
 * — a name without "Sun Tan City" in it, a state that is not the salon's, a
 * city the roster does not name — AND when TWO candidates look equally good.
 *
 * The second is the important one. A resolver that picks the better of two
 * plausible matches is right most of the time and catastrophically wrong
 * occasionally, and the occasion is invisible. "Two candidates matched; a
 * person must choose" is an annoying answer that is never wrong.
 */

/** Only these listings take part in a run. Fail closed is the whole design. */
const RUNNABLE_STATUS: ApifySourceStatus = "verified";

interface LocationRow {
  store_code: string;
  salon_number: string | null;
  location_name: string | null;
  district: string | null;
  google_location_label: string;
  listing_state: GoogleListingState;
  is_active: boolean;
  google_place_id: string | null;
  google_cid: string | null;
  google_maps_url: string | null;
  canonical_google_name: string | null;
  canonical_google_address: string | null;
  expected_state: string | null;
  expected_city: string | null;
  expected_street_hint: string[] | null;
  apify_source_status: ApifySourceStatus;
  apify_last_verified_at: string | null;
  apify_verification_note: string | null;
  discovery_status: DiscoveryStatus;
  discovered_place_id: string | null;
  discovered_name: string | null;
  discovered_address: string | null;
  discovered_maps_url: string | null;
  discovered_cid: string | null;
  discovery_candidate_count: number | null;
  discovered_at: string | null;
  discovery_note: string | null;
  discovery_query: string | null;
  counting_active: boolean;
  reviews_total: number | null;
  reviews_from_apify: number | null;
  reviews_from_brave: number | null;
  latest_published_at: string | null;
  latest_seen_at: string | null;
}

function toMapping(row: LocationRow): ApifyLocationMapping {
  return {
    storeCode: row.store_code,
    salonNumber: row.salon_number,
    locationName: row.location_name ?? row.google_location_label,
    district: row.district,
    googleLocationLabel: row.google_location_label,
    listingState: row.listing_state,
    isActive: row.is_active,
    googlePlaceId: row.google_place_id,
    googleCid: row.google_cid,
    googleMapsUrl: row.google_maps_url,
    canonicalGoogleName: row.canonical_google_name,
    canonicalGoogleAddress: row.canonical_google_address,
    expectedState: row.expected_state,
    expectedCity: row.expected_city,
    expectedStreetHint: row.expected_street_hint,
    sourceStatus: row.apify_source_status,
    lastVerifiedAt: row.apify_last_verified_at,
    verificationNote: row.apify_verification_note,
    discoveryStatus: row.discovery_status ?? "not_searched",
    discoveredPlaceId: row.discovered_place_id,
    discoveredName: row.discovered_name,
    discoveredAddress: row.discovered_address,
    discoveredMapsUrl: row.discovered_maps_url,
    discoveredCid: row.discovered_cid,
    discoveryCandidateCount: row.discovery_candidate_count ?? 0,
    discoveredAt: row.discovered_at,
    discoveryNote: row.discovery_note,
    discoveryQuery: row.discovery_query,
    countingActive: row.counting_active,
    reviewsTotal: row.reviews_total ?? 0,
    reviewsFromApify: row.reviews_from_apify ?? 0,
    reviewsFromBrave: row.reviews_from_brave ?? 0,
    latestPublishedAt: row.latest_published_at,
    latestSeenAt: row.latest_seen_at,
  };
}

/**
 * All fifteen listings, whatever state their mapping is in.
 *
 * ALL FIFTEEN, ALWAYS. A listing with no Google id is a row saying so, not a
 * row that is absent — "locations configured: 14 / 15" is only a useful
 * sentence when the fifteenth is on the list explaining itself.
 */
export async function readLocationMappings(): Promise<ApifyLocationMapping[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("google_review_apify_locations")
    .select("*")
    .order("store_code", { ascending: true });

  if (error) {
    console.error("[reviews/apify] could not read the location mappings", error.code ?? "unknown");
    throw new AiError(
      "bad_request",
      "The Google location mappings could not be read.",
      502,
    );
  }

  return ((data ?? []) as LocationRow[]).map(toMapping);
}

/**
 * The listings a run may actually ask for, and the map that routes the answer.
 *
 * `verified` AND `is_active` AND has an id. Three conditions, all of which must
 * hold, and none of which this function will substitute for another. A pending
 * listing is skipped and reported as skipped — the status panel then says
 * "13 / 15 configured" rather than a run silently covering thirteen salons and
 * everybody believing it covered fifteen.
 */
export interface RunnableLocations {
  /** In store-code order, so a run's input is stable between ticks. */
  locations: ApifyLocationMapping[];
  /** Google place id → store code. The ONLY thing that routes a review. */
  placeToStoreCode: Map<string, string>;
  /** Configured listings that were left out, and why. Operator-facing. */
  skipped: { storeCode: string; reason: string }[];
}

export function selectRunnableLocations(
  mappings: readonly ApifyLocationMapping[],
): RunnableLocations {
  const locations: ApifyLocationMapping[] = [];
  const placeToStoreCode = new Map<string, string>();
  const skipped: { storeCode: string; reason: string }[] = [];

  for (const mapping of mappings) {
    if (!mapping.isActive) {
      skipped.push({ storeCode: mapping.storeCode, reason: "listing_inactive" });
      continue;
    }
    if (mapping.sourceStatus !== RUNNABLE_STATUS || !mapping.googlePlaceId) {
      skipped.push({
        storeCode: mapping.storeCode,
        reason:
          mapping.sourceStatus === "unconfigured"
            ? "no_google_place_id"
            : mapping.sourceStatus === "pending_verification"
              ? "awaiting_verification"
              : mapping.sourceStatus === "rejected"
                ? "verification_rejected"
                : "no_google_place_id",
      });
      continue;
    }

    /*
     * A DUPLICATE PLACE ID WOULD MERGE TWO SALONS' REVIEWS. The unique
     * constraint makes this unreachable through the normal path; it is checked
     * again because the consequence — one salon's customers appearing under
     * another salon's name — is not one to leave to a constraint alone.
     */
    if (placeToStoreCode.has(mapping.googlePlaceId)) {
      skipped.push({ storeCode: mapping.storeCode, reason: "place_id_shared" });
      continue;
    }

    placeToStoreCode.set(mapping.googlePlaceId, mapping.storeCode);
    locations.push(mapping);
  }

  return { locations, placeToStoreCode, skipped };
}

/* ------------------------------------------------------- verification ----- */

export type VerificationOutcome = "verified" | "rejected";

export interface VerificationResult {
  outcome: VerificationOutcome;
  /** A sentence for the operator, naming what did and did not line up. */
  note: string;
}

/** Collapses punctuation and case so "St. Joseph" and "St Joseph" compare. */
function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,'`’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a Google listing really is the salon a store code names.
 *
 * ============================================================================
 * THREE CHECKS, ALL OF WHICH MUST PASS
 * ============================================================================
 *
 *   THE BRAND. Google's own title must contain "sun tan city". A listing that
 *   does not is somebody else's business, whatever else matches.
 *
 *   THE STATE. The salon's two-letter state must appear in Google's address as
 *   a word. Nebraska's Lincoln and Kansas's are different salons, and this is
 *   the cheapest check that separates them.
 *
 *   THE CITY. The city the roster names must appear in Google's address. This
 *   is what stops "Sun Tan City, NE" resolving to the wrong Omaha listing.
 *
 * ANY MISSING EVIDENCE IS A REJECTION, not a pass. A candidate with no address
 * cannot be checked, and "could not check" and "checked and it was fine" must
 * never produce the same outcome.
 *
 * Client-safe in everything but its import list: a pure function of its inputs,
 * so every case below is a test rather than a thing somebody has to believe.
 */
export function verifyPlaceCandidate(
  candidate: { title: string | null; address: string | null },
  expected: { expectedState: string | null; expectedCity: string | null; storeCode: string },
): VerificationResult {
  const title = candidate.title ? comparable(candidate.title) : "";
  const address = candidate.address ? comparable(candidate.address) : "";

  if (title.length === 0) {
    return {
      outcome: "rejected",
      note: "Google returned no business name for this place, so it could not be checked.",
    };
  }
  if (address.length === 0) {
    return {
      outcome: "rejected",
      note: "Google returned no address for this place, so it could not be checked.",
    };
  }

  if (!title.includes("sun tan city")) {
    return {
      outcome: "rejected",
      note: `Google calls this place something other than Sun Tan City, so it is not store code ${expected.storeCode}.`,
    };
  }

  if (!expected.expectedState || !expected.expectedCity) {
    /*
     * NOTHING TO CHECK AGAINST IS ALSO A REJECTION. A listing whose expected
     * city and state were never filled in cannot be verified, and letting it
     * through on a brand match alone would verify "some Sun Tan City".
     */
    return {
      outcome: "rejected",
      note: `Store code ${expected.storeCode} has no expected city and state on record, so this place could not be checked. Fill those in first.`,
    };
  }

  const stateWord = new RegExp(`\\b${expected.expectedState.toLowerCase()}\\b`);
  if (!stateWord.test(address)) {
    return {
      outcome: "rejected",
      note: `Google's address is not in ${expected.expectedState}, which is where store code ${expected.storeCode} is.`,
    };
  }

  if (!address.includes(comparable(expected.expectedCity))) {
    return {
      outcome: "rejected",
      note: `Google's address is not in ${expected.expectedCity}, which is where store code ${expected.storeCode} is.`,
    };
  }

  return {
    outcome: "verified",
    note: `Google's name and address match ${expected.expectedCity}, ${expected.expectedState}.`,
  };
}

/**
 * Choose between candidates for one listing, refusing to choose when two fit.
 *
 * TWO PASSES IS AN AMBIGUITY, AND AMBIGUITY IS A REFUSAL. Two Sun Tan City
 * listings in the same city is a real situation — a salon that moved and whose
 * old listing was never removed — and the right answer is a person looking at
 * both, not a heuristic preferring the one with more reviews.
 */
export function chooseVerifiedCandidate(
  candidates: readonly { placeId: string; title: string | null; address: string | null }[],
  expected: { expectedState: string | null; expectedCity: string | null; storeCode: string },
): { placeId: string; result: VerificationResult } | { placeId: null; result: VerificationResult } {
  const passed = candidates
    .map((candidate) => ({ candidate, result: verifyPlaceCandidate(candidate, expected) }))
    .filter((entry) => entry.result.outcome === "verified");

  if (passed.length === 1) {
    return { placeId: passed[0].candidate.placeId, result: passed[0].result };
  }

  if (passed.length > 1) {
    return {
      placeId: null,
      result: {
        outcome: "rejected",
        note: `${passed.length} Google listings matched store code ${expected.storeCode} equally well. Nothing has been mapped — pick the right one by hand.`,
      },
    };
  }

  return {
    placeId: null,
    result: {
      outcome: "rejected",
      note:
        candidates.length === 0
          ? `Google returned nothing for store code ${expected.storeCode}.`
          : `None of the ${candidates.length} candidates for store code ${expected.storeCode} matched its expected name, city and state.`,
    },
  };
}

/* -------------------------------------------------------- persistence ----- */

const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;

export interface PlaceAssignment {
  storeCode: string;
  placeId: string;
  status: ApifySourceStatus;
  canonicalName?: string | null;
  canonicalAddress?: string | null;
  mapsUrl?: string | null;
  cid?: string | null;
  note?: string | null;
}

export type PlaceAssignmentOutcome =
  | { storeCode: string; status: "ok" }
  | { storeCode: string; status: "unknown_store" }
  | { storeCode: string; status: "invalid_place_id" }
  | { storeCode: string; status: "place_already_mapped"; conflictsWith: string };

/**
 * Write a listing's Google identifier, through the database function that
 * refuses to record `verified` without the evidence for it.
 *
 * THE ALLOWLIST IS APPLIED HERE TOO. A store code arriving from a form is
 * checked against the fifteen before it reaches a query, exactly as the
 * ingestion path checks one arriving from the extension.
 */
export async function assignPlaces(
  assignments: readonly PlaceAssignment[],
): Promise<PlaceAssignmentOutcome[]> {
  const outcomes: PlaceAssignmentOutcome[] = [];
  const admin = getSupabaseAdmin();

  for (const assignment of assignments) {
    const storeCode = assignment.storeCode.trim();

    if (!isAllowedStoreCode(storeCode)) {
      outcomes.push({ storeCode, status: "unknown_store" });
      continue;
    }
    if (!PLACE_ID_PATTERN.test(assignment.placeId.trim())) {
      outcomes.push({ storeCode, status: "invalid_place_id" });
      continue;
    }

    const { data, error } = await admin.rpc("google_review_apify_set_place", {
      p_store_code: storeCode,
      p_place_id: assignment.placeId.trim(),
      p_status: assignment.status,
      p_name: assignment.canonicalName ?? null,
      p_address: assignment.canonicalAddress ?? null,
      p_maps_url: assignment.mapsUrl ?? null,
      p_cid: assignment.cid ?? null,
      p_note: assignment.note ?? null,
    });

    if (error) {
      console.error(
        "[reviews/apify] could not write a location mapping",
        error.code ?? "unknown",
      );
      throw new AiError(
        "bad_request",
        "The Google location mapping could not be saved. Nothing has been changed.",
        502,
      );
    }

    const result = (data ?? {}) as { status?: string; conflictsWith?: string };
    if (result.status === "place_already_mapped") {
      outcomes.push({
        storeCode,
        status: "place_already_mapped",
        conflictsWith: result.conflictsWith ?? "another listing",
      });
      continue;
    }
    if (result.status === "unknown_store") {
      outcomes.push({ storeCode, status: "unknown_store" });
      continue;
    }

    outcomes.push({ storeCode, status: "ok" });
  }

  return outcomes;
}


/* ------------------------------------------- accepting what was proposed --- */

export interface PromotionOutcome {
  storeCode: string;
  status:
    | "verified"
    | "not_a_safe_match"
    | "already_verified"
    | "no_evidence"
    | "place_already_mapped"
    | "unknown_store";
  conflictsWith?: string;
  discoveryStatus?: string;
}

/**
 * Turn unambiguous discoveries into verified mappings.
 *
 * ============================================================================
 * COSTS NOTHING, AND THAT IS THE POINT OF DOING IT THIS WAY
 * ============================================================================
 *
 * The evidence — Google's own name and address — was captured when the
 * candidate was found. Promotion re-reads nothing from Apify, so confirming
 * fourteen locations is a database write, not fourteen Actor runs.
 *
 * ============================================================================
 * THE GATE IS IN POSTGRES, NOT HERE
 * ============================================================================
 *
 * `google_review_apify_promote_discovered` refuses anything that is not
 * `candidate_found` with an id, a name and an address, refuses a place id
 * another salon already holds, and refuses a listing that is already verified.
 * This function filters to the safe set so the screen can say how many will be
 * accepted — but a store code sent by hand that is not safe is refused there,
 * because a UI is not a boundary.
 */
export async function promoteDiscoveredMatches(
  storeCodes: readonly string[],
  actor: string,
): Promise<PromotionOutcome[]> {
  const allowed = storeCodes.map((code) => code.trim()).filter(isAllowedStoreCode);

  if (allowed.length === 0) return [];

  const { data, error } = await getSupabaseAdmin().rpc(
    "google_review_apify_promote_discovered",
    { p_store_codes: allowed, p_actor: actor.slice(0, 100) },
  );

  if (error) {
    console.error("[reviews/apify] could not promote a discovery", error.code ?? "unknown");
    throw new AiError(
      "bad_request",
      "The discovered locations could not be confirmed. Nothing has been changed.",
      502,
    );
  }

  const results = (data ?? {}) as { results?: unknown };
  return Array.isArray(results.results)
    ? (results.results as Record<string, unknown>[]).map((entry) => ({
        storeCode: typeof entry.storeCode === "string" ? entry.storeCode : "unknown",
        status: (typeof entry.status === "string"
          ? entry.status
          : "not_a_safe_match") as PromotionOutcome["status"],
        ...(typeof entry.conflictsWith === "string"
          ? { conflictsWith: entry.conflictsWith }
          : {}),
        ...(typeof entry.discoveryStatus === "string"
          ? { discoveryStatus: entry.discoveryStatus }
          : {}),
      }))
    : [];
}

/**
 * A Google Maps URL or raw identifier, reduced to a place id.
 *
 * ACCEPTS ONLY WHAT IT CAN READ WITH CERTAINTY. A `/maps/place/…` URL with no
 * `place_id` in it carries a CID or an FID instead, and those are different
 * identifiers — returning one as a place id would produce a value that looks
 * right and addresses nothing. Null means "paste the URL that contains a place
 * id", which is a fixable instruction.
 */
export function readPlaceIdFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (PLACE_ID_PATTERN.test(trimmed) && !trimmed.includes("/")) return trimmed;

  /*
   * BOTH SPELLINGS GOOGLE ITSELF USES. A Maps share link carries `place_id`;
   * the URL Google's own Place ID Finder produces carries `query_place_id`.
   * They are the same value, and refusing one of them would send an operator
   * back to look for a URL they already had.
   */
  const query = /[?&](?:query_)?place_id=([A-Za-z0-9_-]{10,255})/.exec(trimmed);
  if (query) return query[1];

  const path = /\/place\/[^/]*\/data=[^/]*!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(trimmed);
  if (path) {
    /*
     * AN FID, NOT A PLACE ID. Refused rather than returned: it is a real,
     * stable Google identifier and it is not the one this column holds, and a
     * mapping that stores the wrong KIND of identifier fails at run time with a
     * message nobody can connect back to this line.
     */
    return null;
  }

  return null;
}
