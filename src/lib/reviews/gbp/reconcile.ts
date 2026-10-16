import type { OfficialReview } from "./normalise";

/**
 * RECONCILING OFFICIAL REVIEWS WITH WHAT IS ALREADY STORED.
 *
 * Stored reviews carry Brave or Apify ids; the API carries its own. They are the
 * same Google reviews under different ids, so something has to say which is
 * which — and getting it wrong in either direction is a real defect:
 *
 *   TOO EAGER  → two different reviews fused: one customer's rating attached to
 *                another, a reply filed on the wrong review.
 *   TOO SHY    → the same review filed twice: a duplicate in every total and in
 *                the response queue.
 *
 * So the rule is asymmetric on purpose. A match is made automatically ONLY when
 * the evidence is strong and unambiguous; everything in between goes to a
 * person; and "new" is declared only when NOTHING stored resembles the review.
 *
 * NEVER name, rating or text alone. The auto-match bar needs ALL of:
 *   - same listing (guaranteed by the caller: both sides are one location's),
 *   - the stored row has a real timestamp and it agrees with Google's createTime
 *       (within 2 minutes when there is no text to corroborate, 48 hours when
 *        the text is identical and non-empty),
 *   - reviewer name equal, rating equal, text equal (or both empty),
 *   - exactly ONE stored row meets that bar for this review, AND this stored row
 *     meets it for no other review.
 * A stored row with no timestamp (Brave-only history) can therefore never be
 * auto-matched: name, rating and text alone are not enough, by instruction.
 *
 * PURE. No database, no network, no clock: the same inputs give the same plan,
 * which is what lets a dry run report exactly what a live run would do.
 */

export interface StoredReview {
  id: string;
  externalReviewId: string;
  gbpReviewId: string | null;
  reviewerName: string;
  rating: number;
  reviewText: string | null;
  googleAbsoluteDate: string | null;
  hasOwnerResponse: boolean;
  ownerResponseText: string | null;
}

export type ReviewReason =
  | "no_timestamp_on_existing"
  | "multiple_candidates"
  | "rating_differs"
  | "name_differs"
  | "text_differs"
  | "time_outside_window"
  | "candidate_claimed_by_another_review";

export type Decision =
  | { kind: "linked"; official: OfficialReview; stored: StoredReview; method: "exact_id" }
  | { kind: "auto_match"; official: OfficialReview; stored: StoredReview; evidence: string[] }
  | { kind: "new"; official: OfficialReview }
  | {
      kind: "needs_review";
      official: OfficialReview;
      candidates: StoredReview[];
      reasons: ReviewReason[];
    };

export interface Discrepancy {
  gbpReviewId: string;
  storedId: string;
  field: "rating" | "text" | "reviewer_name" | "owner_reply";
  stored: string | null;
  official: string | null;
}

export interface ReconciliationPlan {
  decisions: Decision[];
  discrepancies: Discrepancy[];
  /** Stored, unlinked rows no official review accounted for. Reported only — never deleted. */
  unmatchedStored: StoredReview[];
}

/** Tight window: no text to corroborate, so the timestamp must do the work. */
export const TIGHT_WINDOW_MS = 2 * 60 * 1000;
/** Wide window: only with identical non-empty text. Absorbs scrapers that derive dates from relative text. */
export const WIDE_WINDOW_MS = 48 * 60 * 60 * 1000;

export function normaliseName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseText(value: string | null): string {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** "Sarah M" and "Sarah Miller" are compatible; "Sarah" and "Sam" are not. */
function nameCompatible(a: string, b: string): boolean {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (x === y) return true;
  const xt = x.split(" ");
  const yt = y.split(" ");
  if (xt[0] !== yt[0]) return false;
  const lastX = xt[xt.length - 1];
  const lastY = yt[yt.length - 1];
  return (lastX.length === 1 && lastY.startsWith(lastX)) || (lastY.length === 1 && lastX.startsWith(lastY));
}

interface Signals {
  nameEq: boolean;
  nameCompat: boolean;
  ratingEq: boolean;
  textEq: boolean;
  bothTextEmpty: boolean;
  hasTimestamp: boolean;
  deltaMs: number | null;
}

function signals(official: OfficialReview, stored: StoredReview): Signals {
  const officialText = normaliseText(official.comparableText);
  const storedText = normaliseText(stored.reviewText);
  const storedTime = stored.googleAbsoluteDate ? Date.parse(stored.googleAbsoluteDate) : NaN;
  const officialTime = official.createTime ? Date.parse(official.createTime) : NaN;
  const deltaMs = Number.isNaN(storedTime) || Number.isNaN(officialTime) ? null : Math.abs(storedTime - officialTime);

  return {
    nameEq: normaliseName(official.reviewerName) === normaliseName(stored.reviewerName),
    nameCompat: nameCompatible(official.reviewerName, stored.reviewerName),
    ratingEq: official.rating === stored.rating,
    textEq: officialText !== "" && officialText === storedText,
    bothTextEmpty: officialText === "" && storedText === "",
    hasTimestamp: deltaMs !== null,
    deltaMs,
  };
}

function isStrong(s: Signals): boolean {
  if (!s.nameEq || !s.ratingEq || s.deltaMs === null) return false;
  if (s.textEq) return s.deltaMs <= WIDE_WINDOW_MS;
  if (s.bothTextEmpty) return s.deltaMs <= TIGHT_WINDOW_MS;
  return false;
}

/** Broad on purpose: anything resembling the review blocks a "new" verdict. */
function isCandidate(s: Signals): boolean {
  return s.nameCompat || s.textEq || (s.deltaMs !== null && s.deltaMs <= TIGHT_WINDOW_MS);
}

function evidenceFor(s: Signals): string[] {
  const evidence = ["same_listing", "name_equal", "rating_equal"];
  evidence.push(s.textEq ? "text_equal" : "both_text_empty");
  evidence.push(s.deltaMs !== null && s.deltaMs <= TIGHT_WINDOW_MS ? "timestamp_within_2_minutes" : "timestamp_within_48_hours");
  return evidence;
}

function reasonsFor(official: OfficialReview, candidates: StoredReview[], claimed: boolean): ReviewReason[] {
  const reasons = new Set<ReviewReason>();
  if (candidates.length > 1) reasons.add("multiple_candidates");
  if (claimed) reasons.add("candidate_claimed_by_another_review");
  for (const stored of candidates) {
    const s = signals(official, stored);
    if (!s.hasTimestamp) reasons.add("no_timestamp_on_existing");
    else if (s.deltaMs! > WIDE_WINDOW_MS || (!s.textEq && s.deltaMs! > TIGHT_WINDOW_MS)) reasons.add("time_outside_window");
    if (!s.ratingEq) reasons.add("rating_differs");
    if (!s.nameEq) reasons.add("name_differs");
    if (!s.textEq && !s.bothTextEmpty) reasons.add("text_differs");
  }
  return [...reasons];
}

function compare(official: OfficialReview, stored: StoredReview): Discrepancy[] {
  const out: Discrepancy[] = [];
  const base = { gbpReviewId: official.gbpReviewId, storedId: stored.id };
  if (official.rating !== stored.rating) {
    out.push({ ...base, field: "rating", stored: String(stored.rating), official: String(official.rating) });
  }
  if (normaliseText(official.comparableText) !== normaliseText(stored.reviewText)) {
    out.push({ ...base, field: "text", stored: stored.reviewText, official: official.comparableText });
  }
  if (normaliseName(official.reviewerName) !== normaliseName(stored.reviewerName)) {
    out.push({ ...base, field: "reviewer_name", stored: stored.reviewerName, official: official.reviewerName });
  }
  if (normaliseText(official.replyText) !== normaliseText(stored.ownerResponseText)) {
    out.push({ ...base, field: "owner_reply", stored: stored.ownerResponseText, official: official.replyText });
  }
  return out;
}

export function reconcileLocation(
  officials: readonly OfficialReview[],
  stored: readonly StoredReview[],
): ReconciliationPlan {
  const decisions = new Map<string, Decision>();
  const discrepancies: Discrepancy[] = [];
  const claimedStored = new Set<string>();

  const byGbpId = new Map(stored.filter((s) => s.gbpReviewId).map((s) => [s.gbpReviewId as string, s] as const));
  const byExternalId = new Map(stored.map((s) => [s.externalReviewId, s] as const));

  /* 1. Already linked, or filed under the official id itself. Identity is certain. */
  for (const official of officials) {
    const hit = byGbpId.get(official.gbpReviewId) ?? byExternalId.get(official.gbpReviewId);
    if (hit) {
      decisions.set(official.gbpReviewId, { kind: "linked", official, stored: hit, method: "exact_id" });
      claimedStored.add(hit.id);
      discrepancies.push(...compare(official, hit));
    }
  }

  /* 2. Strong evidence, computed for every unresolved pair before anything is claimed. */
  const pool = stored.filter((s) => !claimedStored.has(s.id) && s.gbpReviewId === null);
  const open = officials.filter((o) => !decisions.has(o.gbpReviewId));

  const strongByOfficial = new Map<string, StoredReview[]>();
  const strongByStored = new Map<string, OfficialReview[]>();
  const candidatesByOfficial = new Map<string, StoredReview[]>();

  for (const official of open) {
    const candidates: StoredReview[] = [];
    const strongs: StoredReview[] = [];
    for (const row of pool) {
      const s = signals(official, row);
      if (isCandidate(s)) candidates.push(row);
      if (isStrong(s)) {
        strongs.push(row);
        strongByStored.set(row.id, [...(strongByStored.get(row.id) ?? []), official]);
      }
    }
    candidatesByOfficial.set(official.gbpReviewId, candidates);
    strongByOfficial.set(official.gbpReviewId, strongs);
  }

  for (const official of open) {
    const candidates = candidatesByOfficial.get(official.gbpReviewId) ?? [];
    const strongs = strongByOfficial.get(official.gbpReviewId) ?? [];

    if (candidates.length === 0) {
      decisions.set(official.gbpReviewId, { kind: "new", official });
      continue;
    }

    if (strongs.length === 1 && (strongByStored.get(strongs[0].id)?.length ?? 0) === 1) {
      const match = strongs[0];
      decisions.set(official.gbpReviewId, {
        kind: "auto_match",
        official,
        stored: match,
        evidence: evidenceFor(signals(official, match)),
      });
      claimedStored.add(match.id);
      discrepancies.push(...compare(official, match));
      continue;
    }

    const contested = strongs.some((row) => (strongByStored.get(row.id)?.length ?? 0) > 1);
    decisions.set(official.gbpReviewId, {
      kind: "needs_review",
      official,
      candidates,
      reasons: reasonsFor(official, candidates, contested),
    });
  }

  return {
    decisions: officials.map((o) => decisions.get(o.gbpReviewId) as Decision),
    discrepancies,
    unmatchedStored: stored.filter((s) => !claimedStored.has(s.id) && s.gbpReviewId === null),
  };
}
