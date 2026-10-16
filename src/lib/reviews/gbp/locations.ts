import { ALLOWED_STORE_CODES, isAllowedStoreCode } from "../store-codes";
import type { GbpLocation } from "./types";

/**
 * MATCHING GOOGLE LOCATIONS TO SUN TAN CITY LISTINGS — and refusing to guess.
 *
 * A Glow Brands account can hold more than one brand (Buff City Soap, for one).
 * A location is only ever treated as a Sun Tan City listing when Google's own
 * `storeCode` field names one of the fifteen allowlisted codes. A title that
 * merely says "Sun Tan City" is NOT enough: it is reported as a candidate for a
 * person, never mapped.
 *
 * AND THE STORE-CODE COLLISION RULE STILL APPLIES. Google store code 306 is
 * KS Manhattan; ASK Sunny salon 0306 is a different salon. This module only
 * ever compares a Google store code with `google_review_locations.store_code`
 * — the same namespace — and reaches a salon through that row's foreign key,
 * never through zero-padding.
 *
 * EVIDENCE, IN THE ORDER IT IS TRUSTED
 *   1. store code matches an allowlisted code        (required)
 *   2. exactly one Google location carries that code  (required)
 *   3. Google's place id equals the verified place id already held for the
 *      listing from the Apify verification            (independent evidence)
 * A mapping is `eligible` only with all three. Anything weaker is `needs_review`
 * with the reason, and a person decides.
 */

export interface KnownListing {
  storeCode: string;
  googleLocationLabel: string;
  /** The place id verified during the Apify rollout, when one is held. */
  verifiedPlaceId: string | null;
  /** Already-confirmed Business Profile location, if any. */
  confirmedLocationName: string | null;
}

export type MappingVerdict =
  | "eligible"
  | "already_confirmed"
  | "needs_review"
  | "conflict"
  | "excluded_other_brand";

export interface LocationProposal {
  verdict: MappingVerdict;
  storeCode: string | null;
  googleLocationName: string;
  title: string | null;
  placeId: string | null;
  reasons: string[];
}

export interface MissingListing {
  storeCode: string;
  googleLocationLabel: string;
  reason: "no_google_location_with_store_code";
}

export interface LocationDiscovery {
  proposals: LocationProposal[];
  /** Allowlisted listings for which Google returned nothing. Flagged, never guessed. */
  missing: MissingListing[];
  counts: Record<MappingVerdict, number>;
}

const SUN_TAN_CITY_TITLE = /\bsun\s*tan\s*city\b/i;

export function discoverMappings(
  locations: readonly GbpLocation[],
  listings: readonly KnownListing[],
): LocationDiscovery {
  const listingByCode = new Map(listings.map((l) => [l.storeCode, l] as const));

  const byStoreCode = new Map<string, GbpLocation[]>();
  for (const location of locations) {
    const code = location.storeCode?.trim();
    if (!code) continue;
    const list = byStoreCode.get(code) ?? [];
    list.push(location);
    byStoreCode.set(code, list);
  }

  const proposals: LocationProposal[] = [];

  for (const location of locations) {
    const code = location.storeCode?.trim() || null;
    const base = {
      googleLocationName: location.name,
      title: location.title ?? null,
      placeId: location.placeId ?? null,
    };

    if (!code || !isAllowedStoreCode(code)) {
      /*
       * Not an allowlisted store. Titled like one of ours without a usable code
       * is the one case worth a person's eye; everything else is another brand.
       */
      const looksLikeOurs = !!location.title && SUN_TAN_CITY_TITLE.test(location.title);
      proposals.push({
        ...base,
        verdict: looksLikeOurs ? "needs_review" : "excluded_other_brand",
        storeCode: code,
        reasons: looksLikeOurs
          ? ["title_matches_sun_tan_city_but_store_code_missing_or_not_allowlisted"]
          : ["store_code_not_allowlisted"],
      });
      continue;
    }

    const listing = listingByCode.get(code);
    if (!listing) {
      /* Allowlisted in code but absent from the database: the roster disagrees with itself. */
      proposals.push({ ...base, verdict: "needs_review", storeCode: code, reasons: ["no_listing_row_for_store_code"] });
      continue;
    }

    const reasons: string[] = [];
    const sameCode = byStoreCode.get(code) ?? [];

    if (sameCode.length > 1) {
      proposals.push({ ...base, verdict: "conflict", storeCode: code, reasons: ["multiple_google_locations_share_store_code"] });
      continue;
    }

    if (listing.verifiedPlaceId && location.placeId && listing.verifiedPlaceId !== location.placeId) {
      proposals.push({ ...base, verdict: "conflict", storeCode: code, reasons: ["place_id_differs_from_verified_place_id"] });
      continue;
    }

    if (listing.confirmedLocationName) {
      if (listing.confirmedLocationName === location.name) {
        proposals.push({ ...base, verdict: "already_confirmed", storeCode: code, reasons: [] });
      } else {
        proposals.push({ ...base, verdict: "conflict", storeCode: code, reasons: ["listing_already_confirmed_to_a_different_location"] });
      }
      continue;
    }

    if (!listing.verifiedPlaceId) reasons.push("no_verified_place_id_to_corroborate");
    if (!location.placeId) reasons.push("google_returned_no_place_id");

    proposals.push({
      ...base,
      verdict: reasons.length === 0 ? "eligible" : "needs_review",
      storeCode: code,
      reasons,
    });
  }

  const claimed = new Set(
    proposals.filter((p) => p.storeCode && p.verdict !== "excluded_other_brand").map((p) => p.storeCode as string),
  );
  const missing: MissingListing[] = ALLOWED_STORE_CODES.filter((code) => !claimed.has(code)).map((code) => ({
    storeCode: code,
    googleLocationLabel: listingByCode.get(code)?.googleLocationLabel ?? "",
    reason: "no_google_location_with_store_code",
  }));

  const counts: Record<MappingVerdict, number> = {
    eligible: 0,
    already_confirmed: 0,
    needs_review: 0,
    conflict: 0,
    excluded_other_brand: 0,
  };
  for (const proposal of proposals) counts[proposal.verdict] += 1;

  return { proposals, missing, counts };
}
