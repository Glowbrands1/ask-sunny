/**
 * THE COUNTS-ONLY SUMMARY OF A RUN — what is kept in the run ledger and what the
 * admin screen reads back after a reload.
 *
 * NEVER A NAME, NEVER REVIEW TEXT, NEVER A TOKEN. A run's full report (which can
 * carry short excerpts for a person to compare) goes to the administrator who
 * asked for it and is not persisted; only these figures are, so "what did the
 * last check find" survives a page reload without keeping anybody's words.
 *
 * Client-safe: no server-only import, so the screen can type against it.
 */

export interface RunLocationSummary {
  storeCode: string;
  status: "ok" | "skipped" | "failed";
  errorCode: string | null;
  fetched: number;
  complete: boolean;
  truncated: boolean;
  skippedInvalid: number;
  resourceMismatch: number;
  alreadyLinked: number;
  autoMatched: number;
  newReviews: number;
  deferredNewReviews: number;
  needsReview: number;
  unmatchedStored: number;
  storedTotal: number;
  googleTotal: number | null;
  googleByMonth: Record<string, number>;
  missingByMonth: Record<string, number>;
  inWindow: { google: number; alreadyHeld: number; missing: number; needsReview: number } | null;
  projectedIfFull: { counted: number; historical: number; finding: string | null } | null;
}

export interface RunSummary {
  filing: "enrich_only" | "full";
  window: { from: string; to: string } | null;
  locations: RunLocationSummary[];
}

/** The shape of the report this reads — a structural subset, so this file imports nothing server-side. */
export interface ReportLike {
  filing: "enrich_only" | "full";
  window?: { from: string; to: string };
  locations: {
    storeCode: string;
    status: "ok" | "skipped" | "failed";
    errorCode?: string;
    fetched: number;
    complete: boolean;
    truncated: boolean;
    skippedInvalid: number;
    resourceMismatch: number;
    alreadyLinked: number;
    autoMatched: number;
    newReviews: number;
    deferredNewReviews: number;
    needsReview: number;
    unmatchedStored: number;
    storedTotal: number;
    googleTotal: number | null;
    googleByMonth: Record<string, number>;
    missingByMonth: Record<string, number>;
    inWindow?: { google: number; alreadyHeld: number; missing: number; needsReview: number };
    projectedIfFull?: { counted: number; historical: number; finding: string | null };
  }[];
}

export function buildRunSummary(report: ReportLike): RunSummary {
  return {
    filing: report.filing,
    window: report.window ? { from: report.window.from, to: report.window.to } : null,
    locations: report.locations.map((l) => ({
      storeCode: l.storeCode,
      status: l.status,
      errorCode: l.errorCode ?? null,
      fetched: l.fetched,
      complete: l.complete,
      truncated: l.truncated,
      skippedInvalid: l.skippedInvalid,
      resourceMismatch: l.resourceMismatch,
      alreadyLinked: l.alreadyLinked,
      autoMatched: l.autoMatched,
      newReviews: l.newReviews,
      deferredNewReviews: l.deferredNewReviews,
      needsReview: l.needsReview,
      unmatchedStored: l.unmatchedStored,
      storedTotal: l.storedTotal,
      googleTotal: l.googleTotal,
      googleByMonth: l.googleByMonth,
      missingByMonth: l.missingByMonth,
      inWindow: l.inWindow ?? null,
      projectedIfFull: l.projectedIfFull ?? null,
    })),
  };
}

/** Totals over a summary's listings, for the headline figures. */
export function totalsOf(summary: RunSummary) {
  const t = { listings: summary.locations.length, ok: 0, complete: 0, fetched: 0, held: 0, missing: 0, needsReview: 0, projectedCounted: 0, windowGoogle: 0, windowHeld: 0, windowMissing: 0, windowNeedsReview: 0 };
  for (const l of summary.locations) {
    if (l.status === "ok") t.ok += 1;
    if (l.status === "ok" && l.complete) t.complete += 1;
    t.fetched += l.fetched;
    t.held += l.alreadyLinked + l.autoMatched;
    t.missing += l.newReviews;
    t.needsReview += l.needsReview;
    t.projectedCounted += l.projectedIfFull?.counted ?? 0;
    t.windowGoogle += l.inWindow?.google ?? 0;
    t.windowHeld += l.inWindow?.alreadyHeld ?? 0;
    t.windowMissing += l.inWindow?.missing ?? 0;
    t.windowNeedsReview += l.inWindow?.needsReview ?? 0;
  }
  return t;
}
