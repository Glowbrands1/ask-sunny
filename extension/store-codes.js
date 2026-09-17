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
 */
export function toApiPayload(reviews) {
  return reviews.map((review) => ({
    externalReviewId: review.externalReviewId,
    storeCode: review.storeCode,
    reviewerName: review.reviewerName,
    rating: review.rating,
    reviewText: review.reviewText,
    relativeDateText: review.relativeDateText,
    hasOwnerResponse: review.hasOwnerResponse,
    ownerResponseText: review.ownerResponseText,
    ownerResponseDateText: review.ownerResponseDateText,
  }));
}
