/**
 * THE STORE-CODE ALLOWLIST, EXTENSION COPY.
 *
 * ============================================================================
 * A GOOGLE STORE CODE IS NOT AN ASK SUNNY SALON NUMBER
 * ============================================================================
 *
 * The two overlap without agreeing — Google's 306 is KS Manhattan and ASK
 * Sunny's 0306 is MO Kansas City Wornall — so nothing anywhere converts between
 * them. This file holds only the Google codes; the salon they map to is the
 * server's business and is resolved through `google_review_locations`.
 *
 * ============================================================================
 * WHY THIS COPY EXISTS AND WHAT KEEPS IT HONEST
 * ============================================================================
 *
 * A browser extension cannot import from the Next.js application, so the list
 * lives here as well as in `src/lib/reviews/store-codes.ts` and in the
 * migration that seeds the database. `src/lib/reviews/store-codes.test.ts`
 * reads THIS FILE as text and asserts all three agree, so a salon added to one
 * and forgotten here is a failing test rather than a location that quietly
 * stops importing.
 *
 * THIS IS A COURTESY FILTER, NOT A SECURITY BOUNDARY. It runs on the user's own
 * machine, so it can be edited by whoever holds the laptop. Its job is to stop
 * another business's reviews leaving the machine at all — a privacy nicety that
 * costs nothing. The gates that actually decide are the API route's allowlist
 * and the database's foreign key, and both re-check every record.
 */

export const ALLOWED_STORE_CODES = Object.freeze([
  "140", // MO Kansas City Wornall
  "141", // NE Grand Island
  "143", // NE Kearney
  "144", // NE Lincoln 27th Street
  "145", // NE Lincoln O Street
  "146", // NE Lincoln Pine Lake
  "147", // NE Omaha 132nd and Maple
  "148", // NE Omaha 144th and Center
  "231", // MO Kansas City Liberty
  "254", // NE Omaha Pacific
  "306", // KS Manhattan
  "307", // KS Shawnee Mission Pkwy
  "314", // KS Lawrence
  "373", // KS Overland Park
  "409", // MO St Joseph
]);

/**
 * ============================================================================
 * THE SAME FIFTEEN, WITH THE NAMES A PERSON RECOGNISES
 * ============================================================================
 *
 * The array above is the allowlist and stays the authority; this is a display
 * label per code, so the popup can say "Not observed: 314 — KS Lawrence"
 * instead of printing a bare number at somebody and expecting them to know it.
 *
 * NO SALON NUMBER APPEARS HERE, and that is checked by
 * `src/lib/reviews/store-codes.test.ts`: the extension reports a GOOGLE store
 * code and nothing else, so a stale extension can only fail to send a review,
 * never misfile one. The salon a code belongs to is the server's business.
 *
 * `storeCodeNames()` asserts the two lists agree, so a location added to one
 * and forgotten in the other is a failing test rather than a location that
 * quietly reports as unnamed.
 */
const STORE_CODE_NAMES = Object.freeze({
  "140": "MO Kansas City Wornall",
  "141": "NE Grand Island",
  "143": "NE Kearney",
  "144": "NE Lincoln 27th Street",
  "145": "NE Lincoln O Street",
  "146": "NE Lincoln Pine Lake",
  "147": "NE Omaha 132nd and Maple",
  "148": "NE Omaha 144th and Center",
  "231": "MO Kansas City Liberty",
  "254": "NE Omaha Pacific",
  "306": "KS Manhattan",
  "307": "KS Shawnee Mission Pkwy",
  "314": "KS Lawrence",
  "373": "KS Overland Park",
  "409": "MO St Joseph",
});

export function storeCodeName(code) {
  return STORE_CODE_NAMES[String(code ?? "").trim()] ?? null;
}

/** `["140 — MO Kansas City Wornall", …]`, in allowlist order. */
export function describeStoreCodes(codes) {
  return [...codes]
    .filter((code) => ALLOWED_STORE_CODES.includes(code))
    .sort((a, b) => ALLOWED_STORE_CODES.indexOf(a) - ALLOWED_STORE_CODES.indexOf(b))
    .map((code) => `${code} — ${storeCodeName(code) ?? "name not on record"}`);
}

/**
 * Which of the fifteen this scan actually saw.
 *
 * ============================================================================
 * A LOCATION NOT SEEN IS NOT A LOCATION THAT HAS GONE AWAY
 * ============================================================================
 *
 * The distinction the popup has to make and never blur. A salon missing from a
 * scan may simply have no review in the history Google loaded, or Google may
 * not have exposed it this time, or the listing may be the one awaiting
 * verification. None of those is a reason to drop it from ASK Sunny — all
 * fifteen stay in the roster, on the dashboard and in every total, and this
 * function reports an absence rather than a deletion.
 */
export function coverageReport(seenCodes) {
  const seen = [...new Set([...seenCodes].filter((code) => ALLOWED_STORE_CODES.includes(code)))];
  const missing = ALLOWED_STORE_CODES.filter((code) => !seen.includes(code));

  return {
    seen: describeStoreCodes(seen),
    seenCodes: seen.sort((a, b) => ALLOWED_STORE_CODES.indexOf(a) - ALLOWED_STORE_CODES.indexOf(b)),
    missing: describeStoreCodes(missing),
    missingCodes: missing,
    represented: seen.length,
    total: ALLOWED_STORE_CODES.length,
  };
}

const ALLOWED = new Set(ALLOWED_STORE_CODES);

export function isAllowedStoreCode(value) {
  return typeof value === "string" && ALLOWED.has(value.trim());
}

/**
 * Sorts one page of parsed reviews into what to send and what to count as
 * ignored.
 *
 * FOUR OUTCOMES, AND THE DISTINCTION BETWEEN THE LAST TWO IS THE POINT:
 *
 *   send            one of the fifteen.
 *   ignoredOther    a business that is not Sun Tan City. Expected, and normal —
 *                   the same Google account holds Buff City Soap.
 *   unknownStore    a Sun Tan City review whose store code is not on the list,
 *                   or could not be read. A PARSER PROBLEM worth showing,
 *                   because it means one of ours is being dropped.
 *
 * Reporting those two as one number would let fifteen silently-lost Sun Tan
 * City reviews hide inside "ignored — not Sun Tan City".
 */
export function classifyReviews(parsed) {
  const send = [];
  const ignoredOther = [];
  const unknownStore = [];

  for (const review of parsed) {
    const isOurs = review.businessName
      ? /sun\s*tan\s*city/i.test(review.businessName)
      : null;

    if (review.storeCode && isAllowedStoreCode(review.storeCode)) {
      send.push(review);
      continue;
    }

    /* Named as somebody else's business: ignored, and not a finding. */
    if (isOurs === false) {
      ignoredOther.push(review);
      continue;
    }

    /*
     * Either a Sun Tan City review with an unreadable or unlisted code, or a
     * review whose business could not be identified at all. Both need a human
     * to look, so both are reported rather than quietly dropped.
     */
    unknownStore.push(review);
  }

  return { send, ignoredOther, unknownStore };
}

/**
 * The payload the API accepts.
 *
 * WHAT IS DELIBERATELY NOT SENT: the business name, the parser's strategy
 * record, and whether a Reply button was present. All three are diagnostics for
 * the person holding the laptop; none of them is a fact about the review, and
 * the business name in particular belongs to somebody else's company when it is
 * interesting at all.
 *
 * ============================================================================
 * `feedPosition` — WHY THE ORDER TRAVELS WITH THE REVIEWS
 * ============================================================================
 *
 * ASK Sunny decides which reviews are new by finding the listing's last-counted
 * review in the feed and taking everything above it. That needs the ORDER the
 * page showed, and the page is the only place it exists — so each listing's run
 * is numbered from the top, 0 upward, IN DOCUMENT ORDER.
 *
 * NUMBERED PER LISTING, not across the page. On the combined feed the listings
 * follow one another, and a global index would make one salon's third review
 * comparable with another salon's first, which it is not.
 *
 * THE EXTENSION DOES NOT SAY WHAT THE ORDER MEANS. It reports where things
 * were; the server decides what counts, and refuses to count anything when the
 * order and the relative dates disagree — which is what a page sorted by rating
 * rather than by date looks like.
 */
export function toApiPayload(reviews) {
  const nextPosition = new Map();

  return reviews.map((review) => {
    const position = nextPosition.get(review.storeCode) ?? 0;
    nextPosition.set(review.storeCode, position + 1);

    return {
      externalReviewId: review.externalReviewId,
      storeCode: review.storeCode,
      reviewerName: review.reviewerName,
      rating: review.rating,
      reviewText: review.reviewText,
      relativeDateText: review.relativeDateText,
      hasOwnerResponse: review.hasOwnerResponse,
      ownerResponseText: review.ownerResponseText,
      ownerResponseDateText: review.ownerResponseDateText,
      feedPosition: position,
    };
  });
}
