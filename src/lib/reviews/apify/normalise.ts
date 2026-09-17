/**
 * ============================================================================
 * AN APIFY DATASET, TURNED INTO THE REVIEWS THIS SYSTEM ALREADY UNDERSTANDS
 * ============================================================================
 *
 * The output of this module is `IncomingGoogleReview[]` — the exact shape the
 * Brave extension posts — and it is handed to the exact same
 * `ingestGoogleReviews`. That is the whole integration strategy: Apify replaces
 * the TRANSPORT and nothing downstream of it. The allowlist, the deduplication
 * key, the anchor model, the 3-star rule, the dashboard and the response queue
 * are untouched and cannot be bypassed by arriving through a different door.
 *
 * ============================================================================
 * THE LOCATION IS DECIDED HERE, BY MAPPING AND NEVER BY NAME
 * ============================================================================
 *
 * A dataset record carries a business name and an address, and both are
 * attacker-adjacent in the only sense that matters: they come off a page nobody
 * here controls, and a fuzzy match on "Sun Tan City" would happily attach a
 * franchise location this business does not operate to a real salon's
 * leaderboard row. So the ONLY thing that decides a store code is the place id,
 * looked up in the mapping an operator verified. A record whose place id is not
 * in that map is ignored and counted as unmapped — never matched by name, never
 * matched by address, never matched by "it was the only one left".
 *
 * ============================================================================
 * AND THE ORDER IS PROVEN, NOT ASSUMED
 * ============================================================================
 *
 * The reporting period rests on feed position: a review counts where it sat
 * above its listing's anchor. A dataset arrives as a flat list across all
 * fifteen listings, in whatever order the Actor wrote it, so position cannot be
 * the array index.
 *
 * It is derived from Google's own publication timestamps — which is the whole
 * reason this source is worth having — and derived ONLY where every record for
 * that listing carries one. A listing with a single undated record gets no
 * positions at all, which makes `planPeriodAssignment` report
 * `feed_position_missing` and count nothing for it. That is the same
 * default-deny the extension path already has: an unprovable boundary stores
 * the reviews and moves no number.
 *
 * Client-safe: a pure function of its inputs. No database client, no secret,
 * no `server-only` import, no network.
 */

import type { IncomingGoogleReview } from "../types";
import type { ApifyReviewRecord } from "./types";

/** Google's review id as the database will accept it. Same rule, stated once. */
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;

const MAX_REVIEWER_NAME = 200;
const MAX_REVIEW_TEXT = 8000;
const MAX_DATE_TEXT = 120;

/** Why a record was dropped. CODES only — never a reviewer name, never text. */
export type ApifyRecordProblem =
  /** The record was not an object at all. */
  | "malformed_record"
  /** No stable Google review id. The one refusal with no fallback. */
  | "missing_review_id"
  /** An id that cannot be the database's key. */
  | "invalid_review_id"
  /** No place id, so there is nothing to look the listing up by. */
  | "missing_place_id"
  /** A place id that matches no verified listing. Expected and not an error. */
  | "unknown_place"
  /** A rating that is not a whole 1-5. */
  | "invalid_rating"
  /** No reviewer name, which the database refuses. */
  | "missing_reviewer_name"
  /** The same review id twice in one dataset. Collapsed, not filed twice. */
  | "duplicate_in_dataset"
  /** A listing whose records did not all carry a publication time. */
  | "publication_time_missing";

export interface ApifyNormalisationResult {
  reviews: IncomingGoogleReview[];
  /** Store codes that appeared in the dataset at all, new reviews or not. */
  storeCodesReturned: string[];
  /** Records refused, by reason. Unmapped records are counted separately. */
  invalid: number;
  /** Records for a place this system does not map. Normal, not a failure. */
  unmapped: number;
  problems: { code: ApifyRecordProblem; storeCode?: string }[];
  /**
   * Listings whose ordering could not be established, so nothing can count for
   * them this run. Surfaced rather than swallowed: it is the difference between
   * "quiet week" and "this run proved nothing".
   */
  unorderedStoreCodes: string[];
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, limit);
}

/** The first of several spellings that yields a usable string. */
function firstText(record: ApifyReviewRecord, keys: string[], limit: number): string | null {
  for (const key of keys) {
    const value = text(record[key], limit);
    if (value !== null) return value;
  }
  return null;
}

/** An ISO instant, or null. A junk date is dropped, never guessed at. */
export function isoInstant(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const candidate = text(value, 64);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Google's own place id out of a record.
 *
 * A URL is accepted because some Actors report the listing only as a Maps link,
 * and the id inside it is the same stable value. Nothing is INFERRED: if there
 * is no id in the text, the answer is null and the record is unmapped.
 */
export function readPlaceId(record: ApifyReviewRecord): string | null {
  const direct = firstText(record, ["placeId", "place_id"], 255);
  if (direct && PLACE_ID_PATTERN.test(direct)) return direct;

  const url = firstText(record, ["url", "placeUrl", "reviewUrl"], 500);
  if (url) {
    const match = /[?&]place_id=([A-Za-z0-9_-]{10,255})/.exec(url);
    if (match) return match[1];
  }

  return null;
}

/** A rating as a whole number between 1 and 5, or null. */
export function readRating(record: ApifyReviewRecord): number | null {
  for (const key of ["stars", "rating", "reviewRating", "score"]) {
    const raw = record[key];
    const parsed = typeof raw === "number" ? raw : Number(text(raw, 8) ?? Number.NaN);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) return parsed;
  }
  return null;
}

/** One dataset record, reduced to the facts this system stores. */
interface Candidate {
  externalReviewId: string;
  storeCode: string;
  placeId: string;
  reviewerName: string;
  rating: number;
  reviewText: string | null;
  relativeDateText: string | null;
  publishedAt: string | null;
  hasOwnerResponse: boolean;
  ownerResponseText: string | null;
  ownerResponseDateText: string | null;
}

/**
 * Turn a dataset into reviews, keyed through the verified place mapping.
 *
 * `placeToStoreCode` must contain ONLY listings an operator verified. Passing a
 * pending or rejected mapping in here is how a wrong Google listing becomes a
 * salon's history, so the caller builds the map from `apify_source_status =
 * 'verified'` and nothing else.
 */
export function normaliseApifyDataset(
  records: readonly unknown[],
  placeToStoreCode: ReadonlyMap<string, string>,
): ApifyNormalisationResult {
  const problems: { code: ApifyRecordProblem; storeCode?: string }[] = [];
  const byStore = new Map<string, Candidate[]>();
  const seenReviewIds = new Set<string>();
  let invalid = 0;
  let unmapped = 0;

  for (const entry of records) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalid += 1;
      problems.push({ code: "malformed_record" });
      continue;
    }

    const record = entry as ApifyReviewRecord;

    /*
     * THE PLACE FIRST, so a record belonging to somebody else's business is
     * dropped before anything about a person is read out of it. An unmapped
     * record is not an error and must not be reported as one — the Actor can be
     * pointed at a place we later stop tracking, and the run is still fine.
     */
    const placeId = readPlaceId(record);
    if (!placeId) {
      /*
       * A dataset row with no place id is very often the Actor's own
       * place-level summary record rather than a review, which is why this is
       * counted as unmapped rather than invalid: nothing went wrong.
       */
      unmapped += 1;
      problems.push({ code: "missing_place_id" });
      continue;
    }

    const storeCode = placeToStoreCode.get(placeId);
    if (!storeCode) {
      unmapped += 1;
      problems.push({ code: "unknown_place" });
      continue;
    }

    /*
     * THE STABLE ID, AND THE ONE REFUSAL WITH NO ALTERNATIVE. A review without
     * Google's own id cannot be deduplicated, so filing it would mean a new row
     * every single run — the same customer, endlessly, in the response queue.
     */
    const externalReviewId = firstText(record, ["reviewId", "review_id"], 128);
    if (!externalReviewId) {
      invalid += 1;
      problems.push({ code: "missing_review_id", storeCode });
      continue;
    }
    if (!EXTERNAL_ID_PATTERN.test(externalReviewId)) {
      invalid += 1;
      problems.push({ code: "invalid_review_id", storeCode });
      continue;
    }

    if (seenReviewIds.has(externalReviewId)) {
      /*
       * COUNTED, NOT SILENT. Unlike the extension — where Google's nested
       * markup makes a repeat expected — a dataset holding one review twice
       * says something about the run, so it is reported as a code.
       */
      problems.push({ code: "duplicate_in_dataset", storeCode });
      continue;
    }

    const rating = readRating(record);
    if (rating === null) {
      invalid += 1;
      problems.push({ code: "invalid_rating", storeCode });
      continue;
    }

    const reviewerName = firstText(
      record,
      ["reviewerName", "reviewer_name", "name", "author"],
      MAX_REVIEWER_NAME,
    );
    if (!reviewerName) {
      invalid += 1;
      problems.push({ code: "missing_reviewer_name", storeCode });
      continue;
    }

    seenReviewIds.add(externalReviewId);

    const ownerResponseText = firstText(
      record,
      ["responseFromOwnerText", "responseFromOwner", "ownerResponseText"],
      MAX_REVIEW_TEXT,
    );
    const ownerResponseDate = isoInstant(
      record.responseFromOwnerDate ?? record.ownerResponseDate,
    );

    byStore.set(storeCode, [
      ...(byStore.get(storeCode) ?? []),
      {
        externalReviewId,
        storeCode,
        placeId,
        reviewerName,
        rating,
        /*
         * THE ORIGINAL TEXT ONLY. `textTranslated` is Google's machine
         * translation and is deliberately not stored in its place: the review
         * a salon responds to is the one the customer wrote.
         */
        reviewText: firstText(record, ["text", "reviewText", "comment"], MAX_REVIEW_TEXT),
        /*
         * Google's own relative wording, when the Actor passes it through.
         * Kept verbatim beside the real timestamp for the same reason the
         * extension keeps it: it is what a person sees on the page they are
         * checking the number against.
         */
        relativeDateText: firstText(record, ["publishedAt", "publishedAtText"], MAX_DATE_TEXT),
        publishedAt: isoInstant(record.publishedAtDate ?? record.published_at),
        hasOwnerResponse: ownerResponseText !== null,
        ownerResponseText,
        ownerResponseDateText: ownerResponseDate,
      },
    ]);
  }

  const reviews: IncomingGoogleReview[] = [];
  const unorderedStoreCodes: string[] = [];

  for (const [storeCode, batch] of byStore) {
    /*
     * ORDER FROM GOOGLE'S OWN CLOCK, and only when every record in the batch
     * carries one. A partial ordering is not an ordering: a single undated
     * record among fifty means the boundary between counted and uncounted could
     * fall on either side of it, and the honest answer to that is to count
     * nothing for this listing and say so.
     */
    const everyRecordDated = batch.every((candidate) => candidate.publishedAt !== null);

    const ordered = everyRecordDated
      ? [...batch].sort((a, b) => {
          const left = Date.parse(b.publishedAt as string) - Date.parse(a.publishedAt as string);
          /*
           * A DETERMINISTIC TIE-BREAK. Two reviews can share a timestamp to the
           * second, and a sort that reorders them between two runs would move
           * the anchor's neighbours around. The id is stable and arbitrary,
           * which is exactly what is wanted here.
           */
          return left !== 0 ? left : a.externalReviewId.localeCompare(b.externalReviewId);
        })
      : batch;

    if (!everyRecordDated) {
      unorderedStoreCodes.push(storeCode);
      problems.push({ code: "publication_time_missing", storeCode });
    }

    ordered.forEach((candidate, index) => {
      reviews.push({
        externalReviewId: candidate.externalReviewId,
        storeCode: candidate.storeCode,
        reviewerName: candidate.reviewerName,
        rating: candidate.rating,
        reviewText: candidate.reviewText,
        relativeDateText: candidate.relativeDateText,
        /*
         * THE CANONICAL GOOGLE PUBLICATION TIME. Persisted as
         * `google_absolute_date`, which is the column Phase 1 reserved for
         * exactly this and already surfaces in the review detail panel.
         * `first_seen_at` and `last_seen_at` stay what they were: ingestion
         * audit, never the review's date.
         */
        googleAbsoluteDate: candidate.publishedAt,
        /* Null where the order could not be proven — which counts nothing. */
        feedPosition: everyRecordDated ? index : null,
        hasOwnerResponse: candidate.hasOwnerResponse,
        ownerResponseText: candidate.ownerResponseText,
        ownerResponseDateText: candidate.ownerResponseDateText,
        reportedPlaceId: candidate.placeId,
      });
    });
  }

  return {
    reviews,
    storeCodesReturned: [...byStore.keys()],
    invalid,
    unmapped,
    problems,
    unorderedStoreCodes,
  };
}

/**
 * The place facts a dataset carries, for the verification step and nothing else.
 *
 * Returns what GOOGLE says a place is called and where it is. It decides
 * nothing: `verifyPlaceCandidate` compares these against what the roster
 * expects, and a person confirms the result. Nothing in the ingestion path ever
 * reads a name.
 */
export interface ApifyPlaceFacts {
  placeId: string;
  title: string | null;
  address: string | null;
  cid: string | null;
  reviewCount: number;
}

export function readPlaceFacts(records: readonly unknown[]): ApifyPlaceFacts[] {
  const byPlace = new Map<string, ApifyPlaceFacts>();

  for (const entry of records) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as ApifyReviewRecord;

    const placeId = readPlaceId(record);
    if (!placeId) continue;

    const existing = byPlace.get(placeId);
    const title = firstText(record, ["title", "placeName", "name_of_place"], 300);
    const address = firstText(record, ["address", "placeAddress", "fullAddress"], 400);
    const cid = firstText(record, ["cid"], 30);

    byPlace.set(placeId, {
      placeId,
      /*
       * FIRST NON-NULL WINS. A dataset commonly carries the place facts on the
       * first record and omits them afterwards, so a later blank must not erase
       * what an earlier record established.
       */
      title: existing?.title ?? title,
      address: existing?.address ?? address,
      cid: existing?.cid ?? cid,
      reviewCount: (existing?.reviewCount ?? 0) + 1,
    });
  }

  return [...byPlace.values()];
}
