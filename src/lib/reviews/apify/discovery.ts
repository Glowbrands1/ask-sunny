/**
 * ============================================================================
 * FINDING THE FIFTEEN GOOGLE LISTINGS FROM THE ROSTER ASK SUNNY ALREADY HOLDS
 * ============================================================================
 *
 * One setup run searches Google Maps for each salon and proposes a candidate.
 * Nothing here attaches anything: it produces a per-listing OUTCOME, and a
 * person presses a button that promotes only the unambiguous ones.
 *
 * ============================================================================
 * THE FAILURE THIS MODULE EXISTS TO PREVENT
 * ============================================================================
 *
 * "Sun Tan City" is a franchise brand. A search near Omaha returns locations
 * this business does not operate, and attaching one to a real salon files a
 * stranger's reviews into a district manager's weekly number — permanently,
 * with nothing on the dashboard looking wrong.
 *
 * So the rule is not "pick the best match". It is:
 *
 *   A LISTING IS MATCHED ONLY WHEN EXACTLY ONE CANDIDATE PASSES EVERY CHECK,
 *   AND THAT CANDIDATE PASSES NO OTHER LISTING'S CHECKS.
 *
 * Two candidates for one salon is `ambiguous`. One candidate that fits two
 * salons is `ambiguous` for both. Neither is resolved by preferring the one
 * with more reviews, the one listed first, or the one nearer the middle of the
 * city — every one of those is right most of the time and invisibly wrong
 * occasionally, and the occasion is the one that matters.
 *
 * ============================================================================
 * THE STREET HINT IS WHY THIS WORKS AT ALL
 * ============================================================================
 *
 * ASK Sunny holds no street addresses — the roster is names and states. Three
 * salons are in Lincoln and three in Omaha, so city and state alone cannot
 * separate them and the honest answer for all six would be `ambiguous`.
 *
 * The roster NAMES carry the missing information: "NE Lincoln 27th Street",
 * "NE Omaha 132nd and Maple". Those tokens are seeded into
 * `expected_street_hint` as data, by the migration, rather than parsed out of
 * the label here — a parser would work until somebody renamed a salon and then
 * fail silently. Where a hint is set a candidate must match it. Where it is
 * null, the city is genuinely the identifier, because that salon is the only
 * Sun Tan City in its city.
 *
 * Client-safe: pure functions of their inputs. No database client, no secret,
 * no `server-only` import, no network.
 */

import type { ApifyLocationMapping, ApifyPlaceCandidate, DiscoveryStatus } from "./types";

/** The brand every candidate must carry. Compared case- and punctuation-free. */
export const EXPECTED_BRAND = "sun tan city";

/**
 * Businesses that share this Google account and must never be matched.
 *
 * The brand check above already excludes them, so this is belt and braces —
 * and it is worth having explicitly, because "the other business on the
 * account" is the concrete thing that has already caused a wrong import once
 * on the extension path, and a named check is one somebody can find.
 */
export const NEVER_MATCH = ["buff city soap"];

const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;

/** Collapses case and punctuation so "St. Joseph" and "St Joseph" compare. */
export function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,'`’&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, limit);
}

function firstText(record: Record<string, unknown>, keys: string[], limit: number): string | null {
  for (const key of keys) {
    const value = text(record[key], limit);
    if (value !== null) return value;
  }
  return null;
}

/* ------------------------------------------------------ the search query -- */

/**
 * What this system asks Google for, per listing.
 *
 * Built from the roster and nothing else: the brand, the street hint where one
 * exists, then the city and state. The hint goes BEFORE the city because that
 * is the order a person would type it and the order Google reads best — and
 * because a query that names the street is the one most likely to return the
 * single right listing rather than all three in the city.
 *
 * A listing with no expected city or state produces NO query. It cannot be
 * verified against anything, so searching for it would only produce a candidate
 * nobody could check.
 */
export function buildSearchQuery(location: ApifyLocationMapping): string | null {
  if (!location.expectedCity || !location.expectedState) return null;

  const hint = location.expectedStreetHint?.[0];

  return [
    "Sun Tan City",
    hint ?? "",
    location.expectedCity,
    location.expectedState,
  ]
    .filter((part) => part.trim().length > 0)
    .join(" ");
}

/* ------------------------------------------------ reading a place record -- */

/**
 * One place as a Google Maps places Actor reports it.
 *
 * Alias-tolerant for the same reason the review normaliser is: the Actor is
 * configuration, and the places marketplace spells the same facts two or three
 * ways. The strictness is in the MATCHING, not in the reading.
 */
export function readPlaceCandidate(entry: unknown): ApifyPlaceCandidate | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;

  const placeId = firstText(record, ["placeId", "place_id"], 255);
  if (!placeId || !PLACE_ID_PATTERN.test(placeId)) return null;

  return {
    placeId,
    title: firstText(record, ["title", "name", "placeName"], 300),
    address: firstText(record, ["address", "fullAddress", "formattedAddress"], 400),
    street: firstText(record, ["street", "addressLine1"], 200),
    city: firstText(record, ["city", "locality"], 120),
    state: firstText(record, ["state", "region", "administrativeArea"], 60),
    postalCode: firstText(record, ["postalCode", "postal_code", "zip"], 20),
    cid: firstText(record, ["cid"], 30),
    mapsUrl: firstText(record, ["url", "placeUrl", "mapsUrl"], 500),
    /*
     * A CLOSED LISTING IS NOT A MATCH. Mapping a salon to a permanently closed
     * Google profile would produce a listing that silently returns nothing
     * forever, read on the dashboard as a quiet salon.
     */
    permanentlyClosed: record.permanentlyClosed === true,
    temporarilyClosed: record.temporarilyClosed === true,
    searchString: firstText(record, ["searchString", "searchTerm"], 300),
  };
}

/* --------------------------------------------------------- the matching -- */

export type MatchRejection =
  | "no_name"
  | "no_address"
  | "not_sun_tan_city"
  | "excluded_business"
  | "wrong_state"
  | "wrong_city"
  | "wrong_street"
  | "closed"
  | "no_expectations";

export interface MatchVerdict {
  matches: boolean;
  reason: MatchRejection | "matched";
}

/**
 * Whether one candidate is one listing, checked against everything we know.
 *
 * ORDER MATTERS ONLY FOR THE MESSAGE. Every check must pass; they are ordered
 * so the reason a person reads is the most useful one — "that is Buff City
 * Soap" before "that is in the wrong city".
 *
 * MISSING EVIDENCE IS A REJECTION. A candidate with no address cannot be
 * checked, and "could not check" must never produce the same outcome as
 * "checked and it was fine".
 */
export function candidateMatchesLocation(
  candidate: ApifyPlaceCandidate,
  location: ApifyLocationMapping,
): MatchVerdict {
  if (!location.expectedCity || !location.expectedState) {
    return { matches: false, reason: "no_expectations" };
  }

  if (!candidate.title) return { matches: false, reason: "no_name" };

  const title = comparable(candidate.title);

  for (const excluded of NEVER_MATCH) {
    if (title.includes(excluded)) return { matches: false, reason: "excluded_business" };
  }

  if (!title.includes(EXPECTED_BRAND)) {
    return { matches: false, reason: "not_sun_tan_city" };
  }

  if (candidate.permanentlyClosed || candidate.temporarilyClosed) {
    return { matches: false, reason: "closed" };
  }

  /*
   * THE ADDRESS IS BUILT FROM EVERY FIELD THE ACTOR GAVE US. Some places
   * Actors return `city`, `state` and `postalCode` separately; some fold them
   * into one `address` string. Searching the concatenation of all of them means
   * the check works either way rather than depending on which Actor is
   * configured.
   */
  const haystack = comparable(
    [candidate.address, candidate.street, candidate.city, candidate.state, candidate.postalCode]
      .filter((part): part is string => typeof part === "string")
      .join(" "),
  );

  if (haystack.length === 0) return { matches: false, reason: "no_address" };

  const state = location.expectedState.toLowerCase();
  const stateMatches =
    (candidate.state !== null && comparable(candidate.state) === state) ||
    new RegExp(`\\b${state}\\b`).test(haystack);

  if (!stateMatches) return { matches: false, reason: "wrong_state" };

  const city = comparable(location.expectedCity);
  const cityMatches =
    (candidate.city !== null && comparable(candidate.city) === city) || haystack.includes(city);

  if (!cityMatches) return { matches: false, reason: "wrong_city" };

  /*
   * THE STREET HINT, WHERE ONE EXISTS. This is what separates three salons in
   * Lincoln. Any one token is enough — "132nd and Maple" is stored as two
   * because Google's address usually carries one of them and not the other.
   */
  const hints = location.expectedStreetHint ?? [];
  if (hints.length > 0) {
    const titleAndAddress = `${haystack} ${title}`;
    const hinted = hints.some((hint) => titleAndAddress.includes(comparable(hint)));
    if (!hinted) return { matches: false, reason: "wrong_street" };
  }

  return { matches: true, reason: "matched" };
}

/** What discovery concluded for one listing, and the candidate behind it. */
export interface DiscoveryOutcome {
  storeCode: string;
  status: DiscoveryStatus;
  candidate: ApifyPlaceCandidate | null;
  /** How many candidates passed this listing's checks. */
  candidateCount: number;
  /** The sentence the review table prints. Never a token, never a secret. */
  note: string;
  query: string | null;
}

/**
 * Resolve a whole dataset against the whole roster, symmetrically.
 *
 * ============================================================================
 * WHY EVERY CANDIDATE IS CHECKED AGAINST EVERY LISTING
 * ============================================================================
 *
 * The cheap implementation scopes each candidate to the query that produced it
 * and takes the first that passes. It has one failure mode, and it is the bad
 * one: a candidate that fits TWO salons is accepted for whichever was processed
 * first, silently. Checking the full cross-product costs fifteen times a few
 * dozen string comparisons and turns that into `ambiguous` for both — which is
 * an answer a person can act on.
 *
 * It also means a missing or unreliable `searchString` on the Actor's records
 * changes nothing: the matching never depended on it.
 */
export function resolveDiscovery(
  locations: readonly ApifyLocationMapping[],
  records: readonly unknown[],
): DiscoveryOutcome[] {
  const candidates: ApifyPlaceCandidate[] = [];
  const seen = new Set<string>();

  for (const entry of records) {
    const candidate = readPlaceCandidate(entry);
    if (!candidate || seen.has(candidate.placeId)) continue;
    seen.add(candidate.placeId);
    candidates.push(candidate);
  }

  /* Which listings each candidate fits, and which candidates fit each listing. */
  const matchesByStore = new Map<string, ApifyPlaceCandidate[]>();
  const storesByPlace = new Map<string, string[]>();
  /* Candidates that were right in every way except that Google says closed. */
  const closedByStore = new Map<string, ApifyPlaceCandidate[]>();

  for (const location of locations) {
    matchesByStore.set(location.storeCode, []);
    closedByStore.set(location.storeCode, []);
  }

  for (const candidate of candidates) {
    for (const location of locations) {
      const verdict = candidateMatchesLocation(candidate, location);

      if (verdict.matches) {
        matchesByStore.get(location.storeCode)?.push(candidate);
        storesByPlace.set(candidate.placeId, [
          ...(storesByPlace.get(candidate.placeId) ?? []),
          location.storeCode,
        ]);
        continue;
      }

      /*
       * A CLOSED CANDIDATE IS REPORTED RATHER THAN DISCARDED. "Google says this
       * salon's listing is closed" is a fact somebody needs, and it is not the
       * same as "we found nothing".
       */
      if (verdict.reason === "closed") {
        const openElsewhere = candidateMatchesLocation(
          { ...candidate, permanentlyClosed: false, temporarilyClosed: false },
          location,
        );
        if (openElsewhere.matches) closedByStore.get(location.storeCode)?.push(candidate);
      }
    }
  }

  return locations.map((location) => {
    const query = buildSearchQuery(location);
    const matched = matchesByStore.get(location.storeCode) ?? [];
    const closed = closedByStore.get(location.storeCode) ?? [];

    if (!query) {
      return {
        storeCode: location.storeCode,
        status: "not_found",
        candidate: null,
        candidateCount: 0,
        note: "This listing has no expected city and state on record, so nothing could be searched for or checked.",
        query: null,
      };
    }

    if (matched.length > 1) {
      return {
        storeCode: location.storeCode,
        status: "ambiguous",
        candidate: null,
        candidateCount: matched.length,
        note: `${matched.length} Google listings matched this salon equally well. Nothing has been mapped — choose one by hand.`,
        query,
      };
    }

    if (matched.length === 1) {
      const candidate = matched[0];
      const alsoFits = storesByPlace.get(candidate.placeId) ?? [];

      /*
       * ONE CANDIDATE, TWO SALONS. The other direction of ambiguity, and the
       * one a per-query implementation would miss entirely.
       */
      if (alsoFits.length > 1) {
        const others = alsoFits.filter((code) => code !== location.storeCode);
        return {
          storeCode: location.storeCode,
          status: "ambiguous",
          candidate: null,
          candidateCount: 1,
          note: `The only Google listing that matched this salon also matches store ${others.join(", ")}. Nothing has been mapped — choose by hand.`,
          query,
        };
      }

      return {
        storeCode: location.storeCode,
        status: "candidate_found",
        candidate,
        candidateCount: 1,
        note: `Google's name and address match ${location.expectedCity}, ${location.expectedState}${
          (location.expectedStreetHint ?? []).length > 0 ? " and the expected street" : ""
        }.`,
        query,
      };
    }

    if (closed.length > 0) {
      return {
        storeCode: location.storeCode,
        status: "profile_issue",
        candidate: closed[0],
        candidateCount: closed.length,
        note: "Google marks the matching listing as closed, so it has not been mapped. Check the Google Business Profile.",
        query,
      };
    }

    return {
      storeCode: location.storeCode,
      status: "not_found",
      candidate: null,
      candidateCount: 0,
      note: "Google returned nothing matching this salon's name, city and state. Map it by hand.",
      query,
    };
  });
}

/** The listings a promotion may actually touch. Mirrors the database's gate. */
export function safeMatches(locations: readonly ApifyLocationMapping[]): string[] {
  return locations
    .filter(
      (location) =>
        location.discoveryStatus === "candidate_found" &&
        location.discoveredPlaceId !== null &&
        location.discoveredName !== null &&
        location.discoveredAddress !== null &&
        location.sourceStatus !== "verified",
    )
    .map((location) => location.storeCode);
}
