import "server-only";

import { AiError } from "@/lib/ai/errors";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { planPeriodAssignment, type PlannableReview } from "./period-assignment";
import { isAllowedStoreCode, STORE_CODE_PATTERN } from "./store-codes";
import type { IncomingGoogleReview, ReviewSyncResult } from "./types";

/**
 * GOOGLE REVIEW INGESTION — validation, then one atomic database call.
 *
 * ============================================================================
 * THREE GATES, AND THE ONE THAT COUNTS IS THE LAST
 * ============================================================================
 *
 * The store-code allowlist is applied in three places, deliberately:
 *
 *   IN THE EXTENSION, so a Buff City Soap review never leaves the machine. A
 *   courtesy, and not a security boundary — it runs on the caller's computer.
 *
 *   HERE, so a caller holding a valid token cannot file reviews for a business
 *   this system has no business holding. This is the first gate that is ours.
 *
 *   IN THE DATABASE, where `google_reviews.location_id` is a foreign key into
 *   `google_review_locations`. This is the one that cannot be skipped by any
 *   caller, any route, or any future code path that forgets.
 *
 * ============================================================================
 * WHAT THIS LAYER REFUSES VERSUS WHAT IT IGNORES
 * ============================================================================
 *
 * A MALFORMED RECORD IS REFUSED and counted as `invalid`. A record for a
 * business that is not one of the fifteen is IGNORED and counted as
 * `ignoredNonStc`. The distinction matters at the other end of the wire: the
 * first means the parser read something wrong and somebody should look; the
 * second is the expected, normal state of a Google account that also holds
 * Buff City Soap, and must not be reported as a failure to a manager who just
 * clicked Sync.
 *
 * NEITHER FAILS THE WHOLE BATCH. Forty good reviews are not dropped because
 * the forty-first was unreadable.
 *
 * ============================================================================
 * AND SEPARATELY: WHICH OF THEM COUNT THIS WEEK
 * ============================================================================
 *
 * Admitting a review and COUNTING it are two different decisions, and conflating
 * them is what produced the defect this layer now guards. Everything above is
 * about admission. The reporting period is decided by
 * `planPeriodAssignment` — a review counts only where it sat above its
 * listing's anchor in a feed whose order can be trusted — and a review that is
 * admitted but not proven new is stored as historical and raises nothing.
 *
 * THE ANCHORS ARE READ HERE, ON THE SERVER, moments before the write. The
 * extension never sends an assignment and has no field to put one in.
 */

/**
 * The largest batch one request may carry.
 *
 * The Google reviews page renders a page at a time, so a real sync is tens of
 * records. Five hundred is generous for a manager who has scrolled a long way
 * and small enough that a runaway caller cannot turn one request into a
 * long-running transaction.
 */
export const MAX_REVIEWS_PER_SYNC = 500;

const MAX_REVIEWER_NAME = 200;
const MAX_REVIEW_TEXT = 8000;
const MAX_RELATIVE_TEXT = 120;
/** Matches the database's own `google_reviews_external_id_format`. */
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

/** A record we will send to the database, and why one was dropped. */
interface Normalised {
  accepted: IncomingGoogleReview[];
  invalid: number;
  ignoredNonStc: number;
  problems: { code: string; storeCode?: string }[];
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, limit);
}

/**
 * Validates and normalises the payload, dropping what cannot be filed.
 *
 * Exported for the tests, which are the point: every refusal below is a rule
 * somebody could otherwise quietly loosen, and each has a case in
 * `ingest.test.ts`.
 */
export function normaliseReviewBatch(raw: unknown): Normalised {
  const problems: { code: string; storeCode?: string }[] = [];
  const accepted: IncomingGoogleReview[] = [];
  let invalid = 0;
  let ignoredNonStc = 0;

  if (!Array.isArray(raw)) {
    throw new AiError("bad_request", "The sync payload must carry a list of reviews.", 400);
  }
  if (raw.length > MAX_REVIEWS_PER_SYNC) {
    throw new AiError(
      "bad_request",
      `A single sync may carry at most ${MAX_REVIEWS_PER_SYNC} reviews.`,
      400,
    );
  }

  /*
   * THE SAME `data-lid` TWICE IN ONE PAYLOAD IS NOT AN ERROR.
   *
   * Google's own markup nests elements that share a review's lid, and a parser
   * that misses one nesting level sends the review twice. The database would
   * handle it — the second would simply update the first — but collapsing it
   * here keeps the counts honest: "12 discovered, 12 imported" rather than "13
   * received, 12 created, 1 updated" for a page that held twelve reviews.
   */
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalid += 1;
      problems.push({ code: "malformed_record" });
      continue;
    }

    const record = entry as Record<string, unknown>;

    const externalReviewId = text(record.externalReviewId, 128);
    if (!externalReviewId || !EXTERNAL_ID_PATTERN.test(externalReviewId)) {
      invalid += 1;
      problems.push({ code: "invalid_review_id" });
      continue;
    }

    const storeCodeRaw = text(record.storeCode, 8);
    if (!storeCodeRaw || !STORE_CODE_PATTERN.test(storeCodeRaw)) {
      invalid += 1;
      problems.push({ code: "invalid_store_code" });
      continue;
    }

    /*
     * NOT ONE OF THE FIFTEEN. Ignored, counted, and named by store code only —
     * never by business name, because the name came off a page and is not ours
     * to retain about somebody else's company.
     */
    if (!isAllowedStoreCode(storeCodeRaw)) {
      ignoredNonStc += 1;
      problems.push({ code: "ignored_unknown_store", storeCode: storeCodeRaw });
      continue;
    }

    const rating = typeof record.rating === "number" ? record.rating : Number(record.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      invalid += 1;
      problems.push({ code: "invalid_rating", storeCode: storeCodeRaw });
      continue;
    }

    const reviewerName = text(record.reviewerName, MAX_REVIEWER_NAME);
    if (!reviewerName) {
      invalid += 1;
      problems.push({ code: "missing_reviewer_name", storeCode: storeCodeRaw });
      continue;
    }

    if (seen.has(externalReviewId)) {
      /*
       * Silently collapsed rather than reported: a nested duplicate is the
       * parser doing its job on Google's markup, not a finding.
       */
      continue;
    }
    seen.add(externalReviewId);

    const ownerResponseText = text(record.ownerResponseText, MAX_REVIEW_TEXT);
    /*
     * THE WORDS ARE STRONGER EVIDENCE THAN THE FLAG. A parser can read a reply
     * and miss whatever marker Google puts beside it; it cannot invent the
     * reply's text. So response text present means responded, whatever the
     * boolean says.
     */
    const hasOwnerResponse = record.hasOwnerResponse === true || ownerResponseText !== null;

    accepted.push({
      externalReviewId,
      storeCode: storeCodeRaw,
      reviewerName,
      rating,
      /*
       * WHERE IT SAT ON THE PAGE. The only ordering signal this system has, and
       * the one the reporting period rests on — so it is validated like
       * anything else that arrives from a browser, and a junk value becomes
       * "unknown" rather than a position that would move a boundary.
       */
      feedPosition: boundedPosition(record.feedPosition),
      reviewText: text(record.reviewText, MAX_REVIEW_TEXT),
      relativeDateText: text(record.relativeDateText, MAX_RELATIVE_TEXT),
      googleAbsoluteDate: isoOrNull(record.googleAbsoluteDate),
      hasOwnerResponse,
      ownerResponseText: hasOwnerResponse ? ownerResponseText : null,
      ownerResponseDateText: hasOwnerResponse
        ? text(record.ownerResponseDateText, MAX_RELATIVE_TEXT)
        : null,
    });
  }

  return { accepted, invalid, ignoredNonStc, problems };
}

/** A non-negative integer position, or null. Never a fraction, never a string. */
function boundedPosition(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) return null;
  return parsed;
}

/** An ISO instant, or null. A junk date is dropped rather than rejected. */
function isoOrNull(value: unknown): string | null {
  const candidate = text(value, 64);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Reads each listing's current anchor, so the plan is measured against what the
 * database holds right now rather than against anything a caller asserted.
 *
 * The anchors travel back to the database inside the plan as `expectedAnchor`,
 * and the write refuses any store whose anchor has moved since — which is what
 * stops two machines syncing at once from counting the same reviews twice.
 */
async function readAnchors(storeCodes: string[]): Promise<Map<string, string | null>> {
  const anchors = new Map<string, string | null>();
  if (storeCodes.length === 0) return anchors;

  const { data, error } = await getSupabaseAdmin()
    .from("google_review_locations")
    .select("store_code,counted_through_external_review_id")
    .in("store_code", storeCodes);

  if (error) {
    console.error("[reviews/ingest] could not read the anchors", error.code ?? "unknown");
    throw new AiError(
      "bad_request",
      "The reviews could not be filed. Nothing partial has been stored.",
      502,
    );
  }

  for (const row of (data ?? []) as {
    store_code: string;
    counted_through_external_review_id: string | null;
  }[]) {
    anchors.set(row.store_code, row.counted_through_external_review_id);
  }

  /*
   * A LISTING WITH NO ROW READ IS TREATED AS HAVING NO ANCHOR, which is the
   * safe reading: unknown boundary, count nothing. It should not happen — the
   * allowlist already rejected unknown stores — and if it does, the failure is
   * an undercount rather than an invented week.
   */
  for (const storeCode of storeCodes) {
    if (!anchors.has(storeCode)) anchors.set(storeCode, null);
  }

  return anchors;
}

/**
 * Files a validated batch. Idempotent: the same payload twice creates nothing
 * the second time, and moves no review between periods.
 *
 * TWO DECISIONS, IN TWO PLACES. Which records are admissible is settled above
 * by `normaliseReviewBatch`. WHICH OF THEM COUNT is settled by
 * `planPeriodAssignment` against anchors read here — and then enforced by
 * `ingest_google_reviews`, which refuses a plan measured against an anchor that
 * has since moved, never moves an assigned review, and advances the anchor in
 * the same transaction as the assignment.
 */
export async function ingestGoogleReviews(
  raw: unknown,
  options: { parserVersion: string; credentialId: string | null },
): Promise<ReviewSyncResult> {
  const { accepted, invalid, ignoredNonStc, problems } = normaliseReviewBatch(raw);

  if (accepted.length === 0) {
    /*
     * NOTHING TO FILE, AND THAT IS A VALID ANSWER. An empty payload is how the
     * extension's Options page tests its token, and a page holding only Buff
     * City Soap reviews is a normal Tuesday. Neither is worth a database round
     * trip or a sync-run row.
     */
    return {
      runId: null,
      received: invalid + ignoredNonStc,
      created: 0,
      updated: 0,
      duplicates: 0,
      ignoredNonStc,
      invalid,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
      storeFindings: [],
      problems,
    };
  }

  const storeCodes = [...new Set(accepted.map((review) => review.storeCode))];
  const anchors = await readAnchors(storeCodes);

  const plannable: PlannableReview[] = accepted.map((review) => ({
    externalReviewId: review.externalReviewId,
    storeCode: review.storeCode,
    feedPosition: review.feedPosition ?? null,
    relativeDateText: review.relativeDateText ?? null,
  }));

  const plan = planPeriodAssignment(plannable, anchors);

  const { data, error } = await getSupabaseAdmin().rpc("ingest_google_reviews", {
    p_reviews: accepted.map((review) => ({
      ...review,
      /*
       * NOT A FIELD A CALLER CAN SET. `normaliseReviewBatch` builds every record
       * from a whitelist, so whatever the extension sent under this name was
       * discarded before we got here; this is the server's own decision being
       * attached on its way to the write.
       */
      periodAssignment: plan.assignments.get(review.externalReviewId) ?? "historical",
    })),
    p_parser_version: options.parserVersion,
    p_credential_id: options.credentialId,
    p_store_plans: plan.storePlans.map((store) => ({
      storeCode: store.storeCode,
      expectedAnchor: store.expectedAnchor,
      advanceAnchorTo: store.advanceAnchorTo,
    })),
  });

  if (error) {
    /*
     * The message is not returned to the caller. A Postgres error can carry a
     * constraint name and occasionally a value from the offending row, and the
     * offending row here holds somebody's review.
     */
    console.error("[reviews/ingest] database refused the batch", error.code ?? "unknown");
    throw new AiError(
      "bad_request",
      "The reviews could not be filed. Nothing partial has been stored.",
      502,
    );
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const count = (key: string): number => {
    const value = result[key];
    return typeof value === "number" ? value : 0;
  };

  const databaseProblems = Array.isArray(result.problems)
    ? (result.problems as { code?: unknown; storeCode?: unknown }[]).map((problem) => ({
        code: typeof problem.code === "string" ? problem.code : "unknown",
        ...(typeof problem.storeCode === "string" ? { storeCode: problem.storeCode } : {}),
      }))
    : [];

  return {
    runId: typeof result.runId === "string" ? result.runId : null,
    /* What the CALLER sent, including what this layer dropped before the call. */
    received: count("received") + invalid + ignoredNonStc,
    created: count("created"),
    updated: count("updated"),
    duplicates: count("duplicates"),
    ignoredNonStc: count("ignoredNonStc") + ignoredNonStc,
    invalid: count("invalid") + invalid,
    countedIntoPeriod: count("countedIntoPeriod"),
    storedAsHistorical: count("storedAsHistorical"),
    /*
     * ONLY THE LISTINGS THAT COUNTED NOTHING FOR A REASON. A listing that
     * simply had no new reviews is not a finding, and reporting it as one would
     * bury the listing that genuinely needs an anchor.
     */
    storeFindings: plan.storePlans
      .filter((store) => store.finding !== null)
      .map((store) => ({
        storeCode: store.storeCode,
        finding: store.finding as NonNullable<typeof store.finding>,
        reviews: store.historical,
      })),
    problems: [...problems, ...databaseProblems],
  };
}
