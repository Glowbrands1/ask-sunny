/**
 * ============================================================================
 * WHICH REVIEWS COUNT IN THIS REPORTING PERIOD
 * ============================================================================
 *
 * The rule, in one sentence: a review counts only when it sat ABOVE the
 * listing's anchor in a feed whose order can be trusted. Everything else is
 * stored and counted nowhere.
 *
 * ============================================================================
 * WHY THIS REPLACED "THE WEEK WE FIRST SAW IT"
 * ============================================================================
 *
 * The first implementation keyed the reporting week on `first_seen_at`, on the
 * reasoning that the legacy manual count measures discovery rather than
 * posting. The reasoning was right and the implementation was still wrong in
 * one way that mattered: THE FIRST SYNC OF A LISTING IMPORTS ITS WHOLE
 * BACKLOG, every row is "first seen today", and every one of them lands in this
 * week's official count. Monday's number would have been the size of the
 * import.
 *
 * The manual process never had that problem because it does not ask when a
 * review was noticed. It asks which reviews sit above the last one counted —
 * a POSITION relative to a known boundary. That is what this module computes.
 *
 * ============================================================================
 * WHY IT IS A PURE FUNCTION AND NOT SQL
 * ============================================================================
 *
 * It is a business rule with a dozen cases and it has to be testable without a
 * database, so it is a pure function with a test per case. The invariants that
 * a caller cannot be trusted with — that the anchor has not moved since it was
 * read, that an assigned review never moves period, that the anchor advances in
 * the same transaction — live in `ingest_google_reviews`, which is where they
 * can be enforced rather than merely intended.
 *
 * NOTHING HERE IS CLIENT-CONTROLLED. The extension sends review facts and a
 * feed position; it does not send an assignment, and `normaliseReviewBatch`
 * whitelists the fields it may send at all.
 *
 * Client-safe: no database client, no secret, no `server-only` import.
 */

/** What a review must carry for its position to be judged. */
export interface PlannableReview {
  externalReviewId: string;
  storeCode: string;
  /** Index within this listing's run on the page, 0 = top = newest. */
  feedPosition: number | null;
  /** Google's own words. Used only to sanity-check the submitted order. */
  relativeDateText?: string | null;
  /**
   * GOOGLE'S REAL PUBLICATION INSTANT, when the source has one.
   *
   * Stronger evidence than the relative wording and used in its place where it
   * exists — see `feedOrderLooksReliable`. It checks the ORDER and nothing
   * else: the boundary between counted and uncounted is still the anchor's
   * position, not a timestamp comparison, for the reason in this file's header.
   */
  publishedAt?: string | null;
}

export type PeriodAssignment = "current" | "historical";

/**
 * Why a listing counted nothing. Null when it counted normally — including
 * when it legitimately had nothing new, which is not a finding.
 */
export type StoreFinding =
  /** No baseline has ever been set, so nothing can be called new. */
  | "no_anchor"
  /** The anchored review was not on this page — the boundary is unknown. */
  | "anchor_not_in_feed"
  /** The caller sent no positions, so the feed cannot be ordered. */
  | "feed_position_missing"
  /** The order disagrees with the dates: the page is probably sorted oddly. */
  | "feed_order_unreliable";

export interface StorePlan {
  storeCode: string;
  /**
   * The anchor this plan was measured against, echoed back so the database can
   * refuse the plan if it has moved since. Optimistic concurrency, and the
   * reason two machines syncing at once cannot double-count.
   */
  expectedAnchor: string | null;
  /** The review the anchor advances to, or null when nothing was counted. */
  advanceAnchorTo: string | null;
  counted: number;
  historical: number;
  finding: StoreFinding | null;
}

export interface AssignmentPlan {
  /** Keyed by external review id. Absent means historical. */
  assignments: Map<string, PeriodAssignment>;
  storePlans: StorePlan[];
}

/* ------------------------------------------------- the relative-date read -- */

const RELATIVE = /^(a|an|\d{1,4})\s+(second|minute|hour|day|week|month|year)s?\s+ago$/;

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  /* Calendar-averaged. This is a bucket label, not an instant. */
  month: 2_629_800_000,
  year: 31_557_600_000,
};

/**
 * Google's relative text as an approximate AGE in milliseconds, or null.
 *
 * APPROXIMATE, AND USED ONLY AS A CHECK. Google buckets coarsely — "a month
 * ago" covers five weeks — so this can never decide which period a review
 * belongs to. What it can do is notice that a feed claiming to be newest-first
 * has a week-old review above a day-old one, which is what a page sorted by
 * rating looks like. The same derivation is persisted as
 * `google_estimated_at` for ordering a backlog on screen, and the original
 * text is always kept verbatim beside it.
 *
 * Mirrored in SQL by `google_review_estimate_from_relative`; the two are
 * checked against each other in `period-assignment.test.ts`.
 */
export function approximateAgeMs(relativeDateText: string | null | undefined): number | null {
  if (typeof relativeDateText !== "string") return null;

  const text = relativeDateText.trim().toLowerCase().replace(/^edited\s+/, "");
  if (text.length === 0) return null;

  if (text === "just now" || text === "today" || text === "a moment ago" || text === "moments ago") {
    return 0;
  }
  if (text === "yesterday") return UNIT_MS.day;

  const match = RELATIVE.exec(text);
  if (!match) return null;

  const count = match[1] === "a" || match[1] === "an" ? 1 : Number(match[1]);
  if (!Number.isFinite(count)) return null;

  return count * UNIT_MS[match[2]];
}

/**
 * How old a review is, in milliseconds, from the best evidence available.
 *
 * A REAL TIMESTAMP BEATS GOOGLE'S WORDING, and the Apify source supplies one.
 * "2 days ago" is a bucket that cannot separate two reviews from the same
 * Tuesday; an ISO instant separates them exactly. Where the publication time is
 * present it is used, and the relative text — still stored verbatim — becomes
 * the fallback for the transport that has nothing better.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the comparison is
 * a pure function and the tests are not racing a clock.
 */
function ageMs(review: PlannableReview, now: number): number | null {
  if (typeof review.publishedAt === "string") {
    const parsed = Date.parse(review.publishedAt);
    if (!Number.isNaN(parsed)) return now - parsed;
  }
  return approximateAgeMs(review.relativeDateText);
}

/**
 * Whether a listing's submitted feed really reads newest-first.
 *
 * NO TOLERANCE CONSTANT, and that is deliberate. Google's relative text is
 * bucketed, so a genuinely newest-first run produces ages that are
 * non-decreasing EXACTLY — two reviews from the same Tuesday both read "2 days
 * ago" and tie. A strict decrease going down the page means the page is not in
 * time order, which is what the sort control does. An arbitrary slack here
 * would only blur the signal it exists to catch.
 *
 * The same rule holds for real timestamps, which simply tie less often: a
 * newest-first run is non-increasing in publication time, so an age that goes
 * DOWN as the feed goes on is disorder either way.
 *
 * Pairs where either age is unreadable are skipped rather than counted as
 * disorder: an unparsed date is silence, not evidence.
 */
export function feedOrderLooksReliable(
  reviews: PlannableReview[],
  now: number = Date.now(),
): boolean {
  for (let index = 0; index < reviews.length - 1; index += 1) {
    const older = ageMs(reviews[index], now);
    const next = ageMs(reviews[index + 1], now);
    if (older === null || next === null) continue;
    if (older > next) return false;
  }
  return true;
}

/* ----------------------------------------------------------- the planner -- */

/**
 * Decide, per listing, which reviews on this page are new.
 *
 * `anchors` maps a store code to that listing's current
 * `counted_through_external_review_id`, read from the database moments before.
 * A store missing from the map is treated as having no anchor.
 *
 * DEFAULT-DENY. Every review starts historical and is only promoted when the
 * boundary above it is known. The four findings below are the four ways that
 * can fail, and all of them count nothing rather than guessing.
 */
export function planPeriodAssignment(
  reviews: PlannableReview[],
  anchors: ReadonlyMap<string, string | null>,
): AssignmentPlan {
  const assignments = new Map<string, PeriodAssignment>();
  const storePlans: StorePlan[] = [];

  const byStore = new Map<string, PlannableReview[]>();
  for (const review of reviews) {
    const existing = byStore.get(review.storeCode);
    if (existing) existing.push(review);
    else byStore.set(review.storeCode, [review]);
  }

  for (const [storeCode, batch] of byStore) {
    const anchor = anchors.get(storeCode) ?? null;

    const markAll = (finding: StoreFinding | null) => {
      for (const review of batch) assignments.set(review.externalReviewId, "historical");
      storePlans.push({
        storeCode,
        expectedAnchor: anchor,
        advanceAnchorTo: null,
        counted: 0,
        historical: batch.length,
        finding,
      });
    };

    /*
     * NO BASELINE. The first sync of a listing, and the case the whole
     * correction is about: an import of a year's reviews cannot be called "this
     * week's" because today is the day somebody pressed Sync.
     */
    if (anchor === null) {
      markAll("no_anchor");
      continue;
    }

    /* Positions are how the boundary is located. Without them there is none. */
    const positions = batch.map((review) => review.feedPosition);
    if (positions.some((position) => position === null || !Number.isInteger(position))) {
      markAll("feed_position_missing");
      continue;
    }
    if (new Set(positions).size !== positions.length) {
      /* Two reviews cannot occupy one place on the page. */
      markAll("feed_order_unreliable");
      continue;
    }

    const ordered = [...batch].sort(
      (a, b) => (a.feedPosition as number) - (b.feedPosition as number),
    );

    const anchorIndex = ordered.findIndex(
      (review) => review.externalReviewId === anchor,
    );

    /*
     * THE ANCHOR IS NOT ON THE PAGE. Either the feed did not reach back far
     * enough or the anchored review was removed. Either way the boundary is
     * unknown, and the honest answer is to store everything and count nothing —
     * the operator can scroll further and sync again, or re-anchor.
     */
    if (anchorIndex === -1) {
      markAll("anchor_not_in_feed");
      continue;
    }

    if (!feedOrderLooksReliable(ordered)) {
      markAll("feed_order_unreliable");
      continue;
    }

    /*
     * THE ANCHOR ITSELF IS NEVER COUNTED AGAIN — it was counted in the period
     * that closed on it. Everything below it is older still.
     */
    let counted = 0;
    ordered.forEach((review, index) => {
      const isNew = index < anchorIndex;
      assignments.set(review.externalReviewId, isNew ? "current" : "historical");
      if (isNew) counted += 1;
    });

    storePlans.push({
      storeCode,
      expectedAnchor: anchor,
      /*
       * The anchor moves to the TOP of the page, not to the last review
       * counted one-by-one: everything between is counted in this same plan, so
       * the next sync should start from the newest thing we have now seen.
       * Left null when nothing was counted, so a sync that proves nothing
       * changes nothing.
       */
      advanceAnchorTo: counted > 0 ? ordered[0].externalReviewId : null,
      counted,
      historical: ordered.length - counted,
      finding: null,
    });
  }

  return { assignments, storePlans };
}

/** A human-readable reason, for the extension's results panel. */
export const STORE_FINDING_LABEL: Record<StoreFinding, string> = {
  no_anchor:
    "No reporting anchor yet — imported as history and counted toward nothing. Set the anchor to start counting.",
  anchor_not_in_feed:
    "The last counted review was not on this page — scroll further back and sync again, or re-anchor.",
  feed_position_missing:
    "The sync carried no feed order, so nothing could be proven new.",
  feed_order_unreliable:
    "This page is not in newest-first order — set Google's review sort back to newest and sync again.",
};
