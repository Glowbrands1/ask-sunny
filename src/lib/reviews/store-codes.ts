import { salonByNumber, type ProductionSalon } from "@/data/salons";

/**
 * ============================================================================
 * THE GOOGLE STORE CODE ALLOWLIST — the fifteen Sun Tan City listings
 * ============================================================================
 *
 * ============================================================================
 * A GOOGLE STORE CODE IS NOT AN ASK SUNNY SALON NUMBER
 * ============================================================================
 *
 * Read this before writing any code that touches either. The two numbering
 * systems overlap WITHOUT agreeing, which is the worst case there is — a naive
 * conversion succeeds and is wrong:
 *
 *   Google 306  KS Manhattan               ASK Sunny 0462
 *   ASK Sunny 0306 is MO Kansas City Wornall, whose Google code is 140.
 *
 *   Google 314  KS Lawrence                ASK Sunny 0468
 *   ASK Sunny 0314 is NE Omaha 144th and Center, whose Google code is 148.
 *
 *   Google 307  KS Shawnee Mission Pkwy    ASK Sunny 0463
 *   ASK Sunny 0307 is NE Grand Island, whose Google code is 141.
 *
 * So `\`0${storeCode}\`` compiles, runs, and silently files three salons'
 * reviews against three different salons. Nothing looks broken; the leaderboard
 * is simply wrong, and stays wrong. There is no transformation between the two
 * systems and there never will be — only this table.
 *
 * ============================================================================
 * WHERE ELSE THIS LIST LIVES, AND WHAT KEEPS THE COPIES HONEST
 * ============================================================================
 *
 * Three copies exist, because three different runtimes need it and none of them
 * can import the others:
 *
 *   1. HERE, for the API route's own validation.
 *   2. `supabase/migrations/20260917002000_google_reviews.sql`, seeding
 *      `google_review_locations` — the foreign key a review is filed against.
 *   3. `extension/store-codes.js`, so the browser extension can drop a Buff
 *      City Soap review before it ever leaves the machine.
 *
 * `store-codes.test.ts` reads the other two AS TEXT and asserts all three agree,
 * so a salon added to one and forgotten in another is a failing test rather
 * than a location that silently stops importing.
 *
 * THE DATABASE IS STILL THE AUTHORITY AT WRITE TIME. This list is the fast
 * refusal; `google_review_locations` is the foreign key. A code removed here
 * and left in the table is refused by the route; a code left here and removed
 * from the table is refused by the database. Both directions fail closed.
 */

export interface GoogleReviewLocation {
  /** Google's own store code, as text. Never zero-padded, never a number. */
  readonly storeCode: string;
  /** The ASK Sunny salon number this listing is. Text, and unrelated to the code. */
  readonly salonNumber: string;
  /** The listing's name on Google, for reconciling the two lists by eye. */
  readonly googleLabel: string;
  /**
   * Whether Google currently shows a verification problem on this profile.
   *
   * A FACT ABOUT THE GOOGLE LISTING, NOT ABOUT THE SALON. Both of these salons
   * are trading and both stay in the roster, in the leaderboard and in every
   * total. It is recorded so the dashboard can say "Google is not currently
   * serving reviews for this listing" rather than letting the salon read as a
   * quiet week.
   */
  readonly verificationRequired: boolean;
}

/** The fifteen, in Google store-code order. */
export const GOOGLE_REVIEW_LOCATIONS: readonly GoogleReviewLocation[] = [
  { storeCode: "140", salonNumber: "0306", googleLabel: "Sun Tan City - MO Kansas City Wornall", verificationRequired: true },
  { storeCode: "141", salonNumber: "0307", googleLabel: "Sun Tan City - NE Grand Island", verificationRequired: false },
  { storeCode: "143", salonNumber: "0309", googleLabel: "Sun Tan City - NE Kearney", verificationRequired: false },
  { storeCode: "144", salonNumber: "0310", googleLabel: "Sun Tan City - NE Lincoln 27th Street", verificationRequired: false },
  { storeCode: "145", salonNumber: "0311", googleLabel: "Sun Tan City - NE Lincoln O Street", verificationRequired: false },
  { storeCode: "146", salonNumber: "0312", googleLabel: "Sun Tan City - NE Lincoln Pine Lake", verificationRequired: false },
  { storeCode: "147", salonNumber: "0313", googleLabel: "Sun Tan City - NE Omaha 132nd and Maple", verificationRequired: false },
  { storeCode: "148", salonNumber: "0314", googleLabel: "Sun Tan City - NE Omaha 144th and Center", verificationRequired: false },
  { storeCode: "231", salonNumber: "0394", googleLabel: "Sun Tan City - MO Kansas City Liberty", verificationRequired: false },
  { storeCode: "254", salonNumber: "0410", googleLabel: "Sun Tan City - NE Omaha Pacific", verificationRequired: false },
  { storeCode: "306", salonNumber: "0462", googleLabel: "Sun Tan City - KS Manhattan", verificationRequired: false },
  { storeCode: "307", salonNumber: "0463", googleLabel: "Sun Tan City - KS Shawnee Mission Pkwy", verificationRequired: false },
  { storeCode: "314", salonNumber: "0468", googleLabel: "Sun Tan City - KS Lawrence", verificationRequired: true },
  { storeCode: "373", salonNumber: "0476", googleLabel: "Sun Tan City - KS Overland Park", verificationRequired: false },
  { storeCode: "409", salonNumber: "0495", googleLabel: "Sun Tan City - MO St Joseph", verificationRequired: false },
];

const BY_STORE_CODE = new Map(
  GOOGLE_REVIEW_LOCATIONS.map((entry) => [entry.storeCode, entry] as const),
);

/** Every code this system will ingest, and nothing else. */
export const ALLOWED_STORE_CODES: readonly string[] = GOOGLE_REVIEW_LOCATIONS.map(
  (entry) => entry.storeCode,
);

/**
 * A store code as Google writes it: digits, no padding, no separators.
 *
 * Bounded deliberately. This value arrives from a browser extension reading a
 * page nobody here controls, and it reaches a database query — an unbounded
 * string with a plausible shape is exactly the kind of input that should be
 * refused at the door rather than trimmed later.
 */
export const STORE_CODE_PATTERN = /^[0-9]{1,8}$/;

export function isAllowedStoreCode(value: unknown): value is string {
  return typeof value === "string" && BY_STORE_CODE.has(value.trim());
}

export function locationForStoreCode(
  storeCode: string,
): GoogleReviewLocation | undefined {
  return BY_STORE_CODE.get(storeCode.trim());
}

/**
 * The ASK Sunny salon a Google store code names, from the existing roster.
 *
 * Returns undefined rather than guessing. There is no fallback and there must
 * not be one: an unmapped code means a listing nobody has reconciled, and the
 * right answer is to ignore its reviews and say so, not to file them somewhere
 * plausible.
 */
export function salonForStoreCode(storeCode: string): ProductionSalon | undefined {
  const entry = locationForStoreCode(storeCode);
  return entry ? salonByNumber(entry.salonNumber) : undefined;
}

/** The two listings Google currently marks as needing verification. */
export function listingsNeedingVerification(): readonly GoogleReviewLocation[] {
  return GOOGLE_REVIEW_LOCATIONS.filter((entry) => entry.verificationRequired);
}
