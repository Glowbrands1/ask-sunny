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

export interface ExpectedAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface KnownListing {
  storeCode: string;
  googleLocationLabel: string;
  /** What the roster says the listing's address is (from the Apify verification). Null if not held. */
  expectedAddress?: ExpectedAddress | null;
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
  /** What Google lists, for a person to compare with the roster. */
  address: { street: string | null; city: string | null; state: string | null; postalCode: string | null } | null;
  /** The Business Profile account that holds the location. Filled in by the caller. */
  accountName?: string;
  reasons: string[];
}

/**
 * WHEN A PERSON MAY CONFIRM BY HAND (Ask Bubbles' "Confirm this profile").
 *
 * Only for a listing whose store code matches one and only one Google location
 * and where the ONLY gap is missing corroboration (no place id or address to
 * compare). A conflict (a different place id, a different address, a duplicate
 * store code) is never confirmable: those are facts, not gaps.
 */
export const MANUALLY_CONFIRMABLE_REASONS: readonly string[] = [
  "no_independent_corroboration",
  "no_verified_place_id_or_address_to_corroborate",
];

export function isManuallyConfirmable(proposal: Pick<LocationProposal, "verdict" | "reasons" | "storeCode">): boolean {
  return (
    proposal.verdict === "needs_review" &&
    proposal.storeCode !== null &&
    isAllowedStoreCode(proposal.storeCode) &&
    proposal.reasons.length > 0 &&
    proposal.reasons.every((reason) => MANUALLY_CONFIRMABLE_REASONS.includes(reason))
  );
}

function addressOf(location: GbpLocation): LocationProposal["address"] {
  const a = location.address;
  if (!a) return null;
  return {
    street: (a.addressLines ?? []).filter(Boolean).join(", ") || null,
    city: a.locality ?? null,
    state: a.administrativeArea ?? null,
    postalCode: a.postalCode ?? null,
  };
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

/**
 * ANOTHER BRAND'S TITLE IS BLOCKED FIRST, before any comparison — even if its
 * store code happened to equal one of ours. Ask Bubbles (same Google account)
 * does the mirror image for "Sun Tan City". Store codes are numeric and short, so
 * a future Buff City Soap code could collide with one of ours; the title cannot.
 */
export const OTHER_BRAND_TITLE_MARKERS: readonly string[] = ["buffcitysoap", "buffcity"];

export function isOtherBrandTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const squashed = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  return OTHER_BRAND_TITLE_MARKERS.some((marker) => squashed.includes(marker));
}

const STREET_WORDS: Readonly<Record<string, string>> = {
  street: "st", drive: "dr", road: "rd", avenue: "ave", boulevard: "blvd", lane: "ln", parkway: "pkwy",
  highway: "hwy", court: "ct", circle: "cir", place: "pl", suite: "ste", north: "n", south: "s", east: "e",
  west: "w", northwest: "nw", northeast: "ne", southwest: "sw", southeast: "se",
};

/** Lower-case, strip punctuation, collapse spacing, abbreviate street words. */
export function normalizeAddressText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_WORDS[token] ?? token)
    .join(" ");
}

const plain = (value: string | null | undefined) => normalizeAddressText(value ?? "").replace(/['-]/g, "");

/** True only when street, city, state and ZIP all agree. Absent data is NOT agreement. */
export function addressAgrees(expected: ExpectedAddress | null | undefined, location: GbpLocation): boolean {
  const a = location.address;
  if (!expected || !a) return false;
  const google = ` ${normalizeAddressText((a.addressLines ?? []).join(" "))} `;
  return (
    google.includes(` ${normalizeAddressText(expected.street)} `) &&
    plain(a.locality) === plain(expected.city) &&
    (a.administrativeArea ?? "").trim().toUpperCase() === expected.state.trim().toUpperCase() &&
    (a.postalCode ?? "").trim().slice(0, 5) === expected.postalCode.trim().slice(0, 5)
  );
}

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
      address: addressOf(location),
    };

    if (isOtherBrandTitle(location.title)) {
      proposals.push({ ...base, verdict: "excluded_other_brand", storeCode: code, reasons: ["title_names_another_brand"] });
      continue;
    }

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

    /*
     * INDEPENDENT CORROBORATION beyond the store code: the place id matches the
     * one verified during the Apify rollout, OR the street/city/state/ZIP match
     * the roster's expected address (Ask Bubbles' rule). Either is enough;
     * neither means a person decides.
     */
    const placeAgrees = !!listing.verifiedPlaceId && !!location.placeId && listing.verifiedPlaceId === location.placeId;
    const addressOk = addressAgrees(listing.expectedAddress, location);
    if (!placeAgrees && !addressOk && listing.expectedAddress && location.address) {
      /* Both sides state an address and they disagree: that is a conflict, not a gap. */
      proposals.push({ ...base, verdict: "conflict", storeCode: code, reasons: ["address_differs_from_roster"] });
      continue;
    }
    if (!placeAgrees && !addressOk) {
      reasons.push(listing.verifiedPlaceId || listing.expectedAddress ? "no_independent_corroboration" : "no_verified_place_id_or_address_to_corroborate");
    }

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
