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

import { normaliseState, stateName } from "./address-parse";
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

  /*
   * THE FULL ADDRESS WHERE ONE HAS BEEN RECORDED. "Sun Tan City 2624 Iowa St
   * Ste B Lawrence KS 66046" returns the one listing; "Sun Tan City Lawrence
   * KS" returns every Sun Tan City near Lawrence and leaves the matcher to
   * guess. The postcode goes last because it is the part Google treats as a
   * filter rather than as part of the name.
   */
  if (location.expectedStreetAddress) {
    return [
      "Sun Tan City",
      location.expectedStreetAddress,
      location.expectedCity,
      location.expectedState,
      location.expectedPostalCode ?? "",
    ]
      .filter((part) => part.trim().length > 0)
      .join(" ");
  }

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
/**
 * ============================================================================
 * THE PLACE ID, FROM WHEREVER THE ACTOR PUT IT
 * ============================================================================
 *
 * A place record is useless to this system without a stable Google Place ID —
 * it is what a review run addresses a listing by — so a record whose id cannot
 * be read is dropped. THAT DROP IS SILENT AND EXPENSIVE: a run that returns
 * nineteen real Sun Tan City listings and no readable id reports "not found"
 * for all fifteen salons, which reads as "Google has nothing" rather than "we
 * could not read what Google sent".
 *
 * So the id is looked for in three places, in descending order of directness:
 *
 *   1. A FIELD, under any of the spellings the places marketplace uses.
 *   2. `place_id=` IN A MAPS URL, which is what a share link carries.
 *   3. `query_place_id=` IN A MAPS URL, which is what the search-style URL
 *      `/maps/search/?api=1&query=…&query_place_id=ChIJ…` carries — and that
 *      is the shape this Actor returns.
 *
 * The URL is decoded before it is read, because a `%3F`-escaped query string is
 * still a query string; decoding is wrapped because a malformed escape throws.
 *
 * WHAT IS NEVER AN IDENTIFIER IS THE NAME. Two Sun Tan City listings share one,
 * and a mapping keyed on it would merge two salons the first time it mattered.
 */
export function readPlaceIdFromRecord(record: Record<string, unknown>): string | null {
  const direct = firstText(
    record,
    ["placeId", "place_id", "placeID", "googlePlaceId", "google_place_id", "fid"],
    255,
  );
  if (direct && PLACE_ID_PATTERN.test(direct)) return direct;

  const url = firstText(
    record,
    ["url", "placeUrl", "mapsUrl", "googleMapsUrl", "searchPageUrl", "link"],
    2000,
  );
  if (!url) return null;

  let readable = url;
  try {
    readable = decodeURIComponent(url);
  } catch {
    /* A malformed escape is not a reason to lose the rest of the URL. */
  }

  for (const candidate of [readable, url]) {
    const match = /[?&](?:query_)?place_id=([A-Za-z0-9_-]{10,255})/.exec(candidate);
    if (match && PLACE_ID_PATTERN.test(match[1])) return match[1];
  }

  return null;
}

export function readPlaceCandidate(entry: unknown): ApifyPlaceCandidate | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;

  const placeId = readPlaceIdFromRecord(record);
  if (!placeId) return null;

  return {
    placeId,
    title: firstText(record, ["title", "name", "placeName", "businessName"], 300),
    address: firstText(
      record,
      ["address", "fullAddress", "formattedAddress", "formatted_address"],
      400,
    ),
    street: firstText(record, ["street", "addressLine1", "streetAddress"], 200),
    city: firstText(record, ["city", "locality"], 120),
    state: firstText(
      record,
      ["state", "region", "administrativeArea", "administrative_area_level_1"],
      60,
    ),
    postalCode: firstText(record, ["postalCode", "postal_code", "zip", "zipCode"], 20),
    cid: firstText(record, ["cid"], 30),
    mapsUrl: firstText(record, ["url", "placeUrl", "mapsUrl", "googleMapsUrl"], 500),
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
  /* The expected street address is on record and this is a different door. */
  | "wrong_street_address"
  /* Both sides named a postcode and they disagree. Fatal, never reconciled. */
  | "postal_conflict"
  /* We know which door to look for and the Actor described none. */
  | "no_candidate_street"
  | "closed"
  | "no_expectations";

export interface MatchVerdict {
  matches: boolean;
  reason: MatchRejection | "matched";
  /** How the address compared. `weak` is a city-and-state match, as before. */
  strength: AddressMatchStrength;
}

/* ====================================================================== */
/* THE ADDRESS, WHICH IS WHAT A PERSON ACTUALLY KNOWS ABOUT A SALON       */
/* ====================================================================== */

/**
 * ============================================================================
 * WHY THE STREET IS NORMALISED RATHER THAN COMPARED
 * ============================================================================
 *
 * "2624 Iowa St Ste B" and "2624 Iowa Street" are the same door. One is what an
 * operations manager types; the other is what Google returns. A literal
 * comparison says they are different places, which would send every salon to
 * `not_found` and put us straight back to hunting Place IDs by hand.
 *
 * So both sides are reduced to the same shape before comparing:
 *
 *   THE SUITE IS DROPPED. Google omits it far more often than it includes it,
 *   and a suite is a door within an address rather than a different address.
 *   Keeping it would turn Google's own correct answer into a rejection.
 *
 *   THE SUFFIX IS SPELLED OUT. st, ave, rd, blvd, hwy and the rest are
 *   expanded, so neither side has to guess which abbreviation the other used.
 *
 *   THE DIRECTIONAL IS SPELLED OUT, for the same reason: "W 6th" and "West 6th"
 *   are one street.
 *
 *   THE HOUSE NUMBER IS KEPT APART AND COMPARED EXACTLY. It is the one part of
 *   an address with no synonyms, and two Sun Tan City salons on the same road
 *   differ by it and nothing else. Normalising it away would be the one
 *   "helpful" simplification that merges two real salons.
 *
 * ============================================================================
 * AND "ST" AT THE FRONT IS SAINT, NOT STREET
 * ============================================================================
 *
 * "St Joseph" is a city ASK Sunny trades in. Expanding a suffix wherever it
 * appears would rewrite it to "street joseph" on one side and leave it alone on
 * the other. Suffixes and directionals are therefore expanded only where they
 * cannot be the start of a name.
 */

/** Suffixes both sides may abbreviate, reduced to one spelling. */
const STREET_SUFFIXES: Record<string, string> = {
  st: "street",
  str: "street",
  ave: "avenue",
  av: "avenue",
  rd: "road",
  dr: "drive",
  blvd: "boulevard",
  blv: "boulevard",
  hwy: "highway",
  hway: "highway",
  ln: "lane",
  pkwy: "parkway",
  pky: "parkway",
  ct: "court",
  pl: "place",
  cir: "circle",
  ter: "terrace",
  trl: "trail",
  sq: "square",
  expy: "expressway",
  plz: "plaza",
};

/** Directionals, which either side may give as a letter or a word. */
const DIRECTIONALS: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

/**
 * Everything after one of these is a door within the address, not the address.
 * Cut here rather than filtered out, because what follows is unbounded — "Ste B
 * Building 4 Rear Entrance" is one suite, not three tokens to remove.
 */
const UNIT_MARKERS = new Set([
  "unit",
  "ste",
  "suite",
  "apt",
  "apartment",
  "bldg",
  "building",
  "fl",
  "floor",
  "rm",
  "room",
  "lot",
  "space",
  "spc",
]);

/**
 * ============================================================================
 * A BUSINESS NAME IN FRONT OF AN EXPECTED STREET IS NOT PART OF THE STREET
 * ============================================================================
 *
 * Copying a listing out of Google Maps takes the name with the address, so the
 * stored expectation reads "Sun Tan City, 8420 Wornall Rd" or "Sun Tan City -
 * NE Kearney, 5012 3rd Ave Ste 130". Normalised as a street, that has NO HOUSE
 * NUMBER — the first token is "sun" — and it can never equal the candidate's
 * "8420 wornall road", so the right listing is refused as the wrong door.
 *
 * ============================================================================
 * THE STRIP IS DELIBERATELY NARROW
 * ============================================================================
 *
 * It fires only when the text before a comma contains THIS BRAND and the text
 * after it BEGINS WITH A HOUSE NUMBER. Both conditions matter:
 *
 *   WITHOUT THE BRAND CHECK it would strip the leading part of any
 *   comma-separated address, and "2624 Iowa St, Ste B" would lose its street.
 *
 *   WITHOUT THE NUMBER CHECK it would strip toward something that is not an
 *   address at all, inventing a street out of whatever followed.
 *
 * Anything it does not recognise is returned untouched, so a street it cannot
 * account for stays exactly as a person typed it.
 */
export function stripBrandPrefix(value: string): string {
  const segments = value.split(",").map((segment) => segment.trim());
  if (segments.length < 2) return value;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const before = segments.slice(0, index + 1).join(" ");
    if (!comparable(before).includes(EXPECTED_BRAND)) continue;

    const rest = segments.slice(index + 1).join(", ").trim();
    if (HOUSE_NUMBER_START.test(rest)) return rest;
  }

  return value;
}

/** The remainder has to look like an address before anything is thrown away. */
const HOUSE_NUMBER_START = /^\d/;

/** A house number: digits, optionally with a letter, optionally hyphenated. */
const HOUSE_NUMBER = /^\d+[a-z]?(-\d+[a-z]?)?$/;

export interface NormalisedStreet {
  /** Compared exactly. Null when the side gave no leading number. */
  houseNumber: string | null;
  /** The road itself, one spelling, suite removed. Empty when unreadable. */
  street: string;
}

/**
 * One street line reduced to the shape both sides are compared in.
 *
 * It takes a street LINE, not a full address: the caller passes either the
 * Actor's own `street` field or the part of its formatted address before the
 * first comma, because everything after that comma is the city, state and
 * postcode, which are checked separately and by name.
 */
export function normaliseStreet(value: string | null | undefined): NormalisedStreet {
  if (typeof value !== "string") return { houseNumber: null, street: "" };

  /* `#` is a unit marker written as punctuation, so it is named before the
     punctuation strip removes it and takes the suite's meaning with it. */
  const tokens = comparable(value.replace(/#/g, " unit "))
    .split(" ")
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return { houseNumber: null, street: "" };

  let houseNumber: string | null = null;
  let rest = tokens;

  if (HOUSE_NUMBER.test(tokens[0])) {
    houseNumber = tokens[0];
    rest = tokens.slice(1);
  }

  const cut = rest.findIndex((token) => UNIT_MARKERS.has(token));
  const body = cut === -1 ? rest : rest.slice(0, cut);

  const expanded = body.map((token, index) => {
    /* Never the first word: "St Joseph" is a saint and "N Main" is a north. */
    if (index === 0) return token;
    return STREET_SUFFIXES[token] ?? DIRECTIONALS[token] ?? token;
  });

  /*
   * THE LEADING DIRECTIONAL IS THE ONE EXCEPTION, expanded by position rather
   * than by rule: a single letter cannot begin a street name, so "w 6th" is
   * unambiguously "west 6th" while "st joseph" is not "street joseph".
   */
  if (expanded.length > 1 && DIRECTIONALS[expanded[0]] && expanded[0].length <= 2) {
    expanded[0] = DIRECTIONALS[expanded[0]];
  }

  /*
   * A TRAILING BARE UNIT DESIGNATOR — the "B" in "2624 Iowa St B", the "G" in
   * "1110 S 71st St G". Google prints it sometimes and omits it others, so
   * keeping it would make one spelling of a salon's own address fail to match
   * the other.
   *
   * IT IS ONLY DROPPED AFTER A REAL STREET SUFFIX THAT IS NOT THE STREET'S
   * WHOLE NAME. "100 Avenue B" keeps its B, because there the suffix IS the
   * name and dropping the letter would make Avenue B and Avenue C the same
   * street — which is how two different salons quietly become one.
   */
  if (expanded.length >= 3) {
    const last = expanded[expanded.length - 1];
    const previous = expanded[expanded.length - 2];
    const suffixes = new Set(Object.values(STREET_SUFFIXES));

    if (last.length === 1 && /^[a-z]$/.test(last) && suffixes.has(previous)) {
      expanded.pop();
    }
  }

  return { houseNumber, street: expanded.join(" ").trim() };
}

/** The street line of a candidate, from whichever field the Actor filled. */
export function candidateStreetLine(candidate: ApifyPlaceCandidate): string | null {
  if (candidate.street) return candidate.street;
  if (!candidate.address) return null;
  /* A formatted address is "street, city, state zip, country". */
  const head = candidate.address.split(",")[0]?.trim();
  return head && head.length > 0 ? head : null;
}

/** US postcodes compare on the five-digit part; ZIP+4 is the same postcode. */
function postalKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : null;
}

/**
 * The postcode inside a formatted address, or null.
 *
 * ============================================================================
 * A FIVE-DIGIT HOUSE NUMBER IS NOT A POSTCODE
 * ============================================================================
 *
 * "13110 Birch Dr #120, Omaha, Nebraska" carries no postcode at all, but a
 * naive five-digit search finds 13110 — the house number — and compares it
 * against the salon's real 68164. They differ, so the candidate is refused for
 * a postcode contradiction that does not exist. Three salons were rejected
 * exactly this way, all of them on streets numbered in the ten thousands.
 *
 * So the search takes the LAST five-digit group and refuses one that begins the
 * string, which is where a house number lives. A genuine postcode is at the
 * end, after the city and state; a house number is at the front, always.
 */
function postalFromAddress(address: string | null | undefined): string | null {
  if (typeof address !== "string") return null;

  const matches = [...address.matchAll(/\b\d{5}(?:-\d{4})?\b/g)];
  const last = matches[matches.length - 1];

  if (!last || last.index === undefined) return null;
  if (last.index === 0) return null;

  return postalKey(last[0]);
}

/**
 * How well a candidate's address matches the one ASK Sunny expects.
 *
 *   `exact`  — the same door, confirmed by the postcode as well.
 *   `strong` — the same door, with no postcode on one side to confirm it.
 *   `weak`   — right city and state, and the street hint if one is set, but no
 *              expected street address on record to check against. This is what
 *              every match was before addresses existed.
 *   `none`   — checked, and it is not this salon.
 */
export type AddressMatchStrength = "exact" | "strong" | "weak" | "none";

export const ADDRESS_MATCH_RANK: Record<AddressMatchStrength, number> = {
  exact: 3,
  strong: 2,
  weak: 1,
  none: 0,
};

export interface AddressVerdict {
  strength: AddressMatchStrength;
  reason: MatchRejection | "matched";
}

/**
 * The address half of the check, self-contained so the admin table can print
 * the same verdict the matcher acted on rather than a second opinion.
 *
 * ============================================================================
 * A POSTCODE CONTRADICTION IS FATAL, NOT A DEDUCTION
 * ============================================================================
 *
 * Where both sides carry a postcode and they differ, the candidate is refused
 * outright even if the street line reads the same. Two addresses in one city
 * with different postcodes are two different places, and "the street matched so
 * the zip is probably a typo" is exactly the reasoning that files one salon's
 * customers under another salon's name.
 */
export function addressMatch(
  candidate: ApifyPlaceCandidate,
  location: ApifyLocationMapping,
): AddressVerdict {
  if (!location.expectedCity || !location.expectedState) {
    return { strength: "none", reason: "no_expectations" };
  }

  const haystack = comparable(
    [candidate.address, candidate.street, candidate.city, candidate.state, candidate.postalCode]
      .filter((part): part is string => typeof part === "string")
      .join(" "),
  );

  if (haystack.length === 0) return { strength: "none", reason: "no_address" };

  /*
   * ========================================================================
   * THE TWO SIDES SPELL THE STATE DIFFERENTLY, AND THAT WAS THE WHOLE BUG
   * ========================================================================
   *
   * The roster stores "MO". The places Actor returns "Missouri". The old check
   * compared them as text and searched the address for `\bmo\b`, so BOTH arms
   * failed on every record — and because the state is tested before the street,
   * fifteen salons whose addresses matched perfectly were refused as
   * `wrong_state` and reported as "not found". Nineteen good place records, no
   * matches, and nothing downstream ever ran.
   *
   * Both sides are now reduced to a two-letter code before comparing, and where
   * the Actor gives no state field the address is searched for EITHER spelling.
   */
  const expectedState = normaliseState(location.expectedState);
  const candidateState = candidate.state ? normaliseState(candidate.state) : null;

  const stateMatches = (() => {
    if (expectedState === null) {
      /* An expected state we cannot read is checked the old way rather than
         waved through: unreadable must never be easier to pass than readable. */
      const raw = location.expectedState.toLowerCase();
      return new RegExp(`\\b${raw}\\b`).test(haystack);
    }

    if (candidateState !== null) return candidateState === expectedState;

    const spelled = stateName(expectedState);
    return (
      new RegExp(`\\b${expectedState.toLowerCase()}\\b`).test(haystack) ||
      (spelled !== null && haystack.includes(spelled))
    );
  })();

  if (!stateMatches) return { strength: "none", reason: "wrong_state" };

  const city = comparable(location.expectedCity);
  const cityMatches =
    (candidate.city !== null && comparable(candidate.city) === city) || haystack.includes(city);

  if (!cityMatches) return { strength: "none", reason: "wrong_city" };

  const expectedPostal = postalKey(location.expectedPostalCode);
  const candidatePostal = postalKey(candidate.postalCode) ?? postalFromAddress(candidate.address);

  if (expectedPostal && candidatePostal && expectedPostal !== candidatePostal) {
    return { strength: "none", reason: "postal_conflict" };
  }

  /* ------------------------------------------- with an expected street -- */

  if (location.expectedStreetAddress) {
    const expected = normaliseStreet(stripBrandPrefix(location.expectedStreetAddress));
    const line = candidateStreetLine(candidate);
    const found = normaliseStreet(line);

    if (expected.street.length === 0) {
      /* An expected street we cannot parse is not evidence either way. */
      return { strength: "weak", reason: "matched" };
    }

    const numbersAgree =
      !expected.houseNumber ||
      !found.houseNumber ||
      expected.houseNumber === found.houseNumber;

    if (found.street.length > 0 && numbersAgree && expected.street === found.street) {
      /*
       * BOTH POSTCODES PRESENT AND EQUAL IS THE ONLY WAY TO `exact`. Everything
       * else that got here is the same street with nothing left to confirm it,
       * which is `strong` — good enough to match, and honest about what was and
       * was not checked.
       */
      return expectedPostal && candidatePostal
        ? { strength: "exact", reason: "matched" }
        : { strength: "strong", reason: "matched" };
    }

    /*
     * ======================================================================
     * THE SECOND CHANCE, FOR AN ACTOR THAT RETURNED ONE BLOB
     * ======================================================================
     *
     * Some place records carry the address as a single unstructured string with
     * the street somewhere in the middle, so the part before the first comma is
     * not a street line at all. Rather than refuse those outright, the expected
     * street is looked for inside EVERYTHING the record gave — normalised the
     * same way on both sides, so "St" on one and "Street" on the other still
     * meet.
     *
     * IT CANNOT RESCUE A WRONG ADDRESS. The needle carries the house number, so
     * 2626 Iowa St does not contain 2624 Iowa Street and stays rejected. And a
     * hit here is `strong`, never `exact`: a substring is weaker evidence than
     * two parsed streets agreeing, and the strength is what breaks ties.
     */
    const needle = [expected.houseNumber, expected.street]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" ");

    const whole = normaliseStreet(
      [candidate.address, candidate.street, candidate.city, candidate.state]
        .filter((part): part is string => typeof part === "string")
        .join(" "),
    ).street;

    if (needle.length > 0 && whole.includes(needle)) {
      return { strength: "strong", reason: "matched" };
    }

    return {
      strength: "none",
      reason: found.street.length === 0 ? "no_candidate_street" : "wrong_street_address",
    };
  }

  /* ---------------------------------- without one: the older street hint -- */

  const hints = location.expectedStreetHint ?? [];
  if (hints.length > 0) {
    const title = candidate.title ? comparable(candidate.title) : "";
    const hinted = hints.some((hint) => `${haystack} ${title}`.includes(comparable(hint)));
    if (!hinted) return { strength: "none", reason: "wrong_street" };
  }

  return { strength: "weak", reason: "matched" };
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
    return { matches: false, reason: "no_expectations", strength: "none" };
  }

  if (!candidate.title) return { matches: false, reason: "no_name", strength: "none" };

  const title = comparable(candidate.title);

  for (const excluded of NEVER_MATCH) {
    if (title.includes(excluded)) {
      return { matches: false, reason: "excluded_business", strength: "none" };
    }
  }

  if (!title.includes(EXPECTED_BRAND)) {
    return { matches: false, reason: "not_sun_tan_city", strength: "none" };
  }

  if (candidate.permanentlyClosed || candidate.temporarilyClosed) {
    return { matches: false, reason: "closed", strength: "none" };
  }

  /*
   * THE ADDRESS IS ONE JUDGEMENT, MADE IN ONE PLACE. `addressMatch` owns every
   * geographic check — state, city, postcode, street, hint — and returns how
   * strongly it matched as well as whether it did. This function keeps what is
   * genuinely its own: is it the right brand, and is it open.
   *
   * The strength is carried out of here rather than recomputed by the caller,
   * so the table a person reads and the decision the resolver made cannot
   * disagree about the same candidate.
   */
  const address = addressMatch(candidate, location);

  if (address.strength === "none") {
    return { matches: false, reason: address.reason, strength: "none" };
  }

  return { matches: true, reason: "matched", strength: address.strength };
}

/**
 * What a dataset actually contained, before any matching happened.
 *
 * ============================================================================
 * THE DIFFERENCE BETWEEN "GOOGLE HAD NOTHING" AND "WE COULD NOT READ IT"
 * ============================================================================
 *
 * A run that returns nineteen real listings and no readable Place ID produced
 * exactly the same output as a run that returned nothing at all: fifteen
 * salons marked `not_found`. One of those is Google's answer and the other is
 * our bug, and a system that cannot tell them apart sends somebody to check
 * their Google Business Profiles when the fault is here.
 *
 * `sampleKeys` is the field names of the first unreadable record. It is the one
 * piece of evidence that turns "the Actor changed its schema" from a guess into
 * a fact, and it is safe to surface: they are key names from a public place
 * listing, never values and never a secret.
 */
export interface DatasetShape {
  received: number;
  readable: number;
  /** Field names of the first record whose Place ID could not be read. */
  sampleKeys: string[];
}

export function describeDataset(records: readonly unknown[]): DatasetShape {
  let readable = 0;
  let sampleKeys: string[] = [];

  for (const entry of records) {
    if (readPlaceCandidate(entry) !== null) {
      readable += 1;
      continue;
    }
    if (sampleKeys.length === 0 && entry && typeof entry === "object" && !Array.isArray(entry)) {
      sampleKeys = Object.keys(entry as Record<string, unknown>).slice(0, 40);
    }
  }

  return { received: records.length, readable, sampleKeys };
}

/** What discovery concluded for one listing, and the candidate behind it. */
export interface DiscoveryOutcome {
  storeCode: string;
  status: DiscoveryStatus;
  candidate: ApifyPlaceCandidate | null;
  /** How many candidates passed this listing's checks. */
  candidateCount: number;
  /** The address strength the outcome was decided on. `none` when undecided. */
  strength: AddressMatchStrength;
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

  /** One candidate's standing against one listing. */
  interface Claim {
    candidate: ApifyPlaceCandidate;
    strength: AddressMatchStrength;
  }

  const claimsByStore = new Map<string, Claim[]>();
  /** Every listing a candidate matched, and how strongly. Place id → claims. */
  const strengthByPlace = new Map<string, { storeCode: string; strength: AddressMatchStrength }[]>();
  /* Candidates that were right in every way except that Google says closed. */
  const closedByStore = new Map<string, ApifyPlaceCandidate[]>();

  for (const location of locations) {
    claimsByStore.set(location.storeCode, []);
    closedByStore.set(location.storeCode, []);
  }

  for (const candidate of candidates) {
    for (const location of locations) {
      const verdict = candidateMatchesLocation(candidate, location);

      if (verdict.matches) {
        claimsByStore.get(location.storeCode)?.push({ candidate, strength: verdict.strength });
        strengthByPlace.set(candidate.placeId, [
          ...(strengthByPlace.get(candidate.placeId) ?? []),
          { storeCode: location.storeCode, strength: verdict.strength },
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
    const claims = claimsByStore.get(location.storeCode) ?? [];
    const closed = closedByStore.get(location.storeCode) ?? [];

    if (!query) {
      return {
        storeCode: location.storeCode,
        status: "not_found",
        candidate: null,
        candidateCount: 0,
        strength: "none",
        note: "This listing has no expected city and state on record, so nothing could be searched for or checked.",
        query: null,
      };
    }

    if (claims.length === 0) {
      if (closed.length > 0) {
        return {
          storeCode: location.storeCode,
          status: "profile_issue",
          candidate: closed[0],
          candidateCount: closed.length,
          strength: "none",
          note: "Google marks the matching listing as closed, so it has not been mapped. Check the Google Business Profile.",
          query,
        };
      }

      /*
       * ====================================================================
       * THREE DIFFERENT "NO"S, AND THEY ARE NOT THE SAME NEWS
       * ====================================================================
       *
       * NOTHING READABLE CAME BACK AT ALL is a fault on our side or a change
       * in the Actor's schema. It is not news about this salon, and saying
       * "Google returned nothing" would send somebody to check a Business
       * Profile that is fine.
       *
       * RECORDS CAME BACK AND NONE WAS THIS SALON is a real answer, and the
       * useful next step is an address rather than a support ticket.
       *
       * The count is the whole dataset's, not this listing's, because that is
       * what distinguishes the two.
       */
      if (candidates.length === 0) {
        return {
          storeCode: location.storeCode,
          status: "not_found",
          candidate: null,
          candidateCount: 0,
          strength: "none",
          note: "No usable Google place record came back for this run at all — not for this salon and not for any other. That points at the search or the reader rather than at this listing.",
          query,
        };
      }

      return {
        storeCode: location.storeCode,
        status: "not_found",
        candidate: null,
        candidateCount: 0,
        strength: "none",
        note: `${candidates.length} Google ${
          candidates.length === 1 ? "listing" : "listings"
        } came back for this run and none of them is at this salon's ${
          location.expectedStreetAddress ? "expected address" : "city and state"
        }.${
          location.expectedStreetAddress
            ? " Check the address above, or map it by hand."
            : " Add its street address above and search again, or map it by hand."
        }`,
        query,
      };
    }

    /*
     * ========================================================================
     * THE ADDRESS DECIDES BETWEEN CANDIDATES; IT DOES NOT LOWER THE BAR
     * ========================================================================
     *
     * Every claim here already passed every check. What ranking adds is an
     * answer to "which of these passing candidates is the salon" — and the
     * answer is the one whose ADDRESS matched, over one that merely shares a
     * brand and a city.
     *
     * TIES ARE STILL AMBIGUOUS. Two candidates both matching the expected
     * street exactly is not a near miss to be broken by review count or by
     * order; it is two listings for one door, which a person must look at. The
     * old behaviour — all candidates equal, therefore ambiguous — is exactly
     * this rule when every strength happens to be `weak`.
     */
    const best = claims.reduce(
      (top, claim) => (ADDRESS_MATCH_RANK[claim.strength] > ADDRESS_MATCH_RANK[top] ? claim.strength : top),
      "none" as AddressMatchStrength,
    );
    const top = claims.filter((claim) => claim.strength === best);

    if (top.length > 1) {
      return {
        storeCode: location.storeCode,
        status: "ambiguous",
        candidate: null,
        candidateCount: claims.length,
        strength: best,
        note:
          best === "weak"
            ? `${top.length} Google listings matched this salon's brand, city and state equally well. Add its street address above and search again, or choose one by hand.`
            : `${top.length} Google listings matched this salon's address equally well. Nothing has been mapped — choose one by hand.`,
        query,
      };
    }

    const winner = top[0];
    const alsoFits = strengthByPlace.get(winner.candidate.placeId) ?? [];

    /*
     * ONE CANDIDATE, TWO SALONS — the other direction of ambiguity, and the one
     * a per-query implementation would miss entirely.
     *
     * IT IS NOW SETTLED BY STRENGTH TOO. A listing that matches salon A at its
     * exact street address and salon B only on brand-and-city belongs to A, and
     * saying `ambiguous` for both would throw away the evidence that separates
     * them. Only a rival claim AT LEAST AS STRONG blocks it.
     */
    const rivals = alsoFits.filter(
      (claim) =>
        claim.storeCode !== location.storeCode &&
        ADDRESS_MATCH_RANK[claim.strength] >= ADDRESS_MATCH_RANK[best],
    );

    if (rivals.length > 0) {
      return {
        storeCode: location.storeCode,
        status: "ambiguous",
        candidate: null,
        candidateCount: claims.length,
        strength: best,
        note: `The best Google listing for this salon matches store ${rivals
          .map((rival) => rival.storeCode)
          .join(", ")} just as well. Nothing has been mapped — add street addresses for both, or choose by hand.`,
        query,
      };
    }

    return {
      storeCode: location.storeCode,
      status: "candidate_found",
      candidate: winner.candidate,
      candidateCount: claims.length,
      strength: best,
      note:
        best === "exact"
          ? `Google's address and postcode match the expected address exactly.`
          : best === "strong"
            ? `Google's address matches the expected street address.`
            : `Google's name and address match ${location.expectedCity}, ${location.expectedState}${
                (location.expectedStreetHint ?? []).length > 0 ? " and the expected street" : ""
              }. No street address is on record for this salon, so this was matched on city and state alone.`,
      query,
    };
  });
}

/**
 * The listings a rediscovery may search, and the ones it must leave alone.
 *
 * ============================================================================
 * IT EXISTS SO A SECOND SEARCH COSTS A FRACTION OF THE FIRST
 * ============================================================================
 *
 * The common shape of this work is: search all fifteen, get eleven, add street
 * addresses for the four that failed, search again. Searching all fifteen the
 * second time pays for eleven answers nobody needs.
 *
 * WHAT IT SEARCHES is what is genuinely unresolved — never searched, ambiguous,
 * or not found.
 *
 * WHAT IT LEAVES ALONE:
 *
 *   VERIFIED, because a mapping somebody signed off is not something a button
 *   press should re-open. The database refuses to overwrite one regardless.
 *
 *   PENDING VERIFICATION, because that listing already HAS an identifier
 *   somebody pasted, and it is waiting for a check rather than for a search.
 *
 *   CANDIDATE FOUND, because a proposal is already sitting there waiting to be
 *   accepted; searching again would spend credits to produce it a second time.
 *
 *   PROFILE ISSUE, because Google said that listing is closed. Asking again
 *   tomorrow will not change Google's mind, and the fix is on the Business
 *   Profile rather than here.
 *
 * ============================================================================
 * AND `searching` COUNTS AS UNRESOLVED, WHICH IS NOT AN OVERSIGHT
 * ============================================================================
 *
 * A discovery marks its listings `searching` before it starts. When the Actor
 * run then ends as ABORTED or FAILED, a reset returns them — but if that reset
 * is ever missed, a listing stranded in `searching` would be excluded from the
 * one button that exists to retry the failure, and the problem would disable
 * its own fix. It happened once, to all fifteen at once.
 *
 * Counting it here cannot start a duplicate search: every control that begins
 * a run is closed while one is live, so a `searching` row this function can see
 * is a row whose search never came back.
 */
export function unresolvedForRediscovery(
  locations: readonly ApifyLocationMapping[],
): ApifyLocationMapping[] {
  return locations.filter(
    (location) =>
      location.isActive &&
      location.sourceStatus !== "verified" &&
      location.sourceStatus !== "pending_verification" &&
      (location.discoveryStatus === "not_searched" ||
        location.discoveryStatus === "searching" ||
        location.discoveryStatus === "ambiguous" ||
        location.discoveryStatus === "not_found"),
  );
}

/**
 * The address verdict for what is ALREADY STORED against a listing.
 *
 * The admin table has to print how well the address matched, and the only
 * honest way to do that is to ask the same function the resolver asked rather
 * than to re-implement a comparison beside it. The stored address is turned
 * back into the shape `addressMatch` reads: it parses the city, state and
 * postcode out of a formatted address string anyway, because places Actors
 * routinely return one blob instead of separate fields.
 *
 * `none` means either that there is nothing stored to compare, or that what is
 * stored does not match the expectation — which is itself worth seeing, because
 * it is what an operator would want to know after correcting an address under a
 * mapping that was made before it.
 */
export function storedAddressMatch(location: ApifyLocationMapping): AddressMatchStrength {
  const address = location.canonicalGoogleAddress ?? location.discoveredAddress;
  const name = location.canonicalGoogleName ?? location.discoveredName;
  const placeId = location.googlePlaceId ?? location.discoveredPlaceId;

  if (!address || !placeId) return "none";

  return addressMatch(
    {
      placeId,
      title: name,
      address,
      street: null,
      city: null,
      state: null,
      postalCode: null,
      cid: null,
      mapsUrl: null,
      permanentlyClosed: false,
      temporarilyClosed: false,
      searchString: null,
    },
    location,
  ).strength;
}

/** How an address verdict is written on the admin table. */
export function addressMatchLabel(strength: AddressMatchStrength): string {
  if (strength === "exact") return "Exact — street and postcode";
  if (strength === "strong") return "Street matches";
  if (strength === "weak") return "City and state only";
  return "No address match";
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
