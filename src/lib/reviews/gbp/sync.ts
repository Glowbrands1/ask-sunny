import "server-only";

import { ingestGoogleReviews } from "../ingest";
import type { IncomingGoogleReview, ReviewSyncResult } from "../types";
import type { GbpClient } from "./client";
import { liveBackfillAllowed, readSyncMode, type GbpLimits, type GbpSyncMode } from "./config";
import { GbpApiError } from "./http";
import { normaliseOfficialReview, toIncoming, type OfficialReview } from "./normalise";
import { reconcileLocation, type Decision, type Discrepancy } from "./reconcile";
import type { GbpStore, LinkInput, MappedLocation, ReviewItemInput } from "./store";

/**
 * THE SYNC: official reviews → reconcile → (dry run: report) | (live: file).
 *
 * ============================================================================
 * WHAT THIS CAN AND CANNOT TOUCH
 * ============================================================================
 *
 * ONLY CONFIRMED LISTINGS. A listing syncs only if a person confirmed its
 * Business Profile location (`gbp_mapping_status = 'confirmed'`). Locations that
 * belong to another brand are never in that set, so they are never even
 * requested from Google.
 *
 * A DRY RUN WRITES NOTHING. Not review data, not links, not the review queue,
 * not even a ledger row. It reads Google and the database and returns the
 * report.
 *
 * LIVE FILES THROUGH THE EXISTING PIPELINE. New and already-known reviews both
 * go through `ingestGoogleReviews`, so the allowlist, the anchor model, the
 * 3-star rule and the write-once reporting week are exactly the ones Apify and
 * Brave already live under. A review already stored is filed under its EXISTING
 * external id (so the anchor still finds it); only a genuinely new review is
 * filed under the official id.
 *
 * AMBIGUOUS REVIEWS ARE NEVER FILED. They go to the manual-review table and are
 * left out of the batch entirely.
 *
 * STORED NAME AND TEXT ARE KEPT. For a review already stored, the reviewer name
 * and text on file are what is sent back through ingestion, so a difference
 * between Apify's reading and Google's shows up as a discrepancy in the report
 * rather than as a silent overwrite. Rating and a missing owner reply are taken
 * from Google.
 */

export const GBP_PARSER_VERSION = "gbp-api-v1";
export const GBP_CREDENTIAL_ID = "gbp-oauth";

export type SyncScope = "incremental" | "backfill";
export type SyncTrigger = "cron" | "pubsub" | "admin";

export interface SyncOptions {
  /** What the caller asks for. The environment can only lower this, never raise it. */
  requestedMode: "dry_run" | "live";
  scope: SyncScope;
  trigger: SyncTrigger;
  storeCodes?: readonly string[];
}

export interface SyncDeps {
  client: GbpClient;
  store: GbpStore;
  limits: GbpLimits;
  env?: NodeJS.ProcessEnv;
  ingest?: (
    reviews: IncomingGoogleReview[],
    options: { parserVersion: string; credentialId: string | null; ingestionSource: "gbp_api" },
  ) => Promise<ReviewSyncResult>;
}

export interface ReviewExcerpt {
  gbpReviewId: string;
  rating: number;
  reviewer: string;
  createTime: string | null;
  excerpt: string | null;
}

export interface LocationReport {
  storeCode: string;
  label: string;
  status: "ok" | "skipped" | "failed";
  errorCode?: string;
  fetched: number;
  truncated: boolean;
  skippedInvalid: number;
  alreadyLinked: number;
  autoMatched: number;
  newReviews: number;
  needsReview: number;
  unmatchedStored: number;
  storedTotal: number;
  googleTotal: number | null;
  googleAverage: number | null;
  storedAverage: number | null;
  discrepancies: Discrepancy[];
  needsReviewItems: (ReviewExcerpt & { reasons: string[]; candidateIds: string[] })[];
  newItems: ReviewExcerpt[];
  filed?: { created: number; updated: number; countedIntoPeriod: number; storedAsHistorical: number };
  links?: { linked: number; refreshed: number; conflicts: number };
}

export interface SyncReport {
  mode: "dry_run" | "live";
  scope: SyncScope;
  status: "disabled" | "succeeded" | "partial" | "failed" | "refused";
  reason?: string;
  requests: number;
  locations: LocationReport[];
  totals: {
    fetched: number;
    alreadyLinked: number;
    autoMatched: number;
    newReviews: number;
    needsReview: number;
    failedLocations: number;
  };
}

const EXCERPT = 80;

function excerpt(review: OfficialReview): ReviewExcerpt {
  return {
    gbpReviewId: review.gbpReviewId,
    rating: review.rating,
    reviewer: review.reviewerName,
    createTime: review.createTime,
    excerpt: review.comment ? review.comment.slice(0, EXCERPT) : null,
  };
}

function emptyLocation(mapping: MappedLocation): LocationReport {
  return {
    storeCode: mapping.storeCode,
    label: mapping.label,
    status: "ok",
    fetched: 0,
    truncated: false,
    skippedInvalid: 0,
    alreadyLinked: 0,
    autoMatched: 0,
    newReviews: 0,
    needsReview: 0,
    unmatchedStored: 0,
    storedTotal: 0,
    googleTotal: null,
    googleAverage: null,
    storedAverage: null,
    discrepancies: [],
    needsReviewItems: [],
    newItems: [],
  };
}

function byNewest(a: OfficialReview, b: OfficialReview): number {
  const left = a.createTime ? Date.parse(a.createTime) : 0;
  const right = b.createTime ? Date.parse(b.createTime) : 0;
  return right - left || a.gbpReviewId.localeCompare(b.gbpReviewId);
}

export async function runGbpSync(options: SyncOptions, deps: SyncDeps): Promise<SyncReport> {
  const env = deps.env ?? process.env;
  const envMode: GbpSyncMode = readSyncMode(env);

  const base = {
    scope: options.scope,
    requests: 0,
    locations: [] as LocationReport[],
    totals: { fetched: 0, alreadyLinked: 0, autoMatched: 0, newReviews: 0, needsReview: 0, failedLocations: 0 },
  };

  if (envMode === "off") {
    return { ...base, mode: "dry_run", status: "disabled", reason: "GBP_SYNC_MODE is off." };
  }

  /* The environment can lower the mode, never raise it: dry_run in env forces a dry run. */
  const mode: "dry_run" | "live" = envMode === "live" && options.requestedMode === "live" ? "live" : "dry_run";

  if (mode === "live" && options.scope === "backfill" && !liveBackfillAllowed(env)) {
    return {
      ...base,
      mode,
      status: "refused",
      reason: "A live historical backfill needs GBP_ALLOW_LIVE_BACKFILL=true. Run it as a dry run first.",
    };
  }

  const mappings = await deps.store.readConfirmedMappings(options.storeCodes);
  const maxPages = options.scope === "backfill" ? deps.limits.backfillMaxPages : deps.limits.incrementalMaxPages;

  const runId = mode === "live" ? await deps.store.startRun({ mode: "live", scope: options.scope, trigger: options.trigger }) : null;

  const locations: LocationReport[] = [];
  let fatal: GbpApiError | null = null;

  for (const mapping of mappings) {
    const report = emptyLocation(mapping);
    locations.push(report);

    if (fatal) {
      report.status = "skipped";
      report.errorCode = fatal.code;
      continue;
    }

    try {
      await syncLocation(mapping, report, mode, maxPages, deps);
    } catch (error) {
      report.status = "failed";
      if (error instanceof GbpApiError) {
        report.errorCode = error.code;
        /* Revoked auth, an unapproved API and an exhausted budget fail every listing alike. */
        if (error.code === "auth_revoked" || error.code === "auth_failed" || error.code === "forbidden" || error.code === "request_budget_exceeded") {
          fatal = error;
        }
      } else {
        report.errorCode = "unexpected_error";
        console.error("[reviews/gbp/sync] listing failed", mapping.storeCode);
      }
    }
  }

  const failed = locations.filter((l) => l.status !== "ok").length;
  const totals = locations.reduce(
    (sum, l) => ({
      fetched: sum.fetched + l.fetched,
      alreadyLinked: sum.alreadyLinked + l.alreadyLinked,
      autoMatched: sum.autoMatched + l.autoMatched,
      newReviews: sum.newReviews + l.newReviews,
      needsReview: sum.needsReview + l.needsReview,
      failedLocations: sum.failedLocations,
    }),
    { ...base.totals, failedLocations: failed },
  );

  const status: SyncReport["status"] = failed === 0 ? "succeeded" : failed === locations.length ? "failed" : "partial";
  const report: SyncReport = {
    mode,
    scope: options.scope,
    status,
    requests: deps.client.requestCount,
    locations,
    totals,
  };

  if (mode === "live") {
    await deps.store.finishRun(runId, {
      status: status === "failed" ? "failed" : status === "partial" ? "partial" : "succeeded",
      requests: report.requests,
      /* Counts and codes only — no review text and no names. */
      summary: locations.map((l) => ({
        storeCode: l.storeCode,
        status: l.status,
        errorCode: l.errorCode ?? null,
        fetched: l.fetched,
        autoMatched: l.autoMatched,
        newReviews: l.newReviews,
        needsReview: l.needsReview,
        truncated: l.truncated,
      })),
      errorCode: fatal ? (fatal as GbpApiError).code : null,
    });
  }

  return report;
}

async function syncLocation(
  mapping: MappedLocation,
  report: LocationReport,
  mode: "dry_run" | "live",
  maxPages: number,
  deps: SyncDeps,
): Promise<void> {
  const fetched = await deps.client.listReviews(mapping.accountName, mapping.gbpLocationName, maxPages);
  const stored = await deps.store.readStoredReviews(mapping.locationId);

  const officials: OfficialReview[] = [];
  for (const raw of fetched.reviews) {
    const outcome = normaliseOfficialReview(raw, mapping.storeCode);
    if (outcome.ok) officials.push(outcome.review);
    else report.skippedInvalid += 1;
  }

  /* A review listed twice across pages is one review. */
  const unique = [...new Map(officials.map((o) => [o.gbpReviewId, o] as const)).values()];

  const plan = reconcileLocation(unique, stored);

  report.fetched = unique.length;
  report.truncated = fetched.truncated;
  report.storedTotal = stored.length;
  report.googleTotal = fetched.totalReviewCount;
  report.googleAverage = fetched.averageRating;
  report.storedAverage = stored.length
    ? Math.round((stored.reduce((sum, s) => sum + s.rating, 0) / stored.length) * 100) / 100
    : null;
  report.discrepancies = plan.discrepancies;
  /* Only meaningful when the whole feed was read. */
  report.unmatchedStored = fetched.truncated ? 0 : plan.unmatchedStored.length;

  for (const decision of plan.decisions) {
    if (decision.kind === "linked") report.alreadyLinked += 1;
    else if (decision.kind === "auto_match") report.autoMatched += 1;
    else if (decision.kind === "new") {
      report.newReviews += 1;
      report.newItems.push(excerpt(decision.official));
    } else {
      report.needsReview += 1;
      report.needsReviewItems.push({
        ...excerpt(decision.official),
        reasons: decision.reasons,
        candidateIds: decision.candidates.map((c) => c.id),
      });
    }
  }

  if (mode === "dry_run") return;

  await fileLive(mapping, report, plan.decisions, deps);
}

async function fileLive(
  mapping: MappedLocation,
  report: LocationReport,
  decisions: Decision[],
  deps: SyncDeps,
): Promise<void> {
  const fileable = decisions
    .filter((d): d is Exclude<Decision, { kind: "needs_review" }> => d.kind !== "needs_review")
    .sort((a, b) => byNewest(a.official, b.official));

  const batch: IncomingGoogleReview[] = fileable.map((decision, position) => {
    const { official } = decision;
    if (decision.kind === "new") {
      return toIncoming(official, {
        externalReviewId: official.gbpReviewId,
        feedPosition: position,
        reportedPlaceId: mapping.gbpPlaceId,
        reviewerName: official.reviewerName,
        rating: official.rating,
        reviewText: official.comment,
        googleAbsoluteDate: official.createTime,
        hasOwnerResponse: official.replyText !== null,
        ownerResponseText: official.replyText,
      });
    }
    const { stored } = decision;
    /* Stored name and text are kept; rating and a missing reply come from Google. */
    const keepReply = stored.hasOwnerResponse && stored.ownerResponseText !== null;
    const replyText = keepReply ? stored.ownerResponseText : official.replyText;
    return toIncoming(official, {
      externalReviewId: stored.externalReviewId,
      feedPosition: position,
      reportedPlaceId: mapping.gbpPlaceId,
      reviewerName: stored.reviewerName,
      rating: official.rating,
      reviewText: stored.reviewText,
      googleAbsoluteDate: stored.googleAbsoluteDate ?? official.createTime,
      hasOwnerResponse: keepReply || official.replyText !== null,
      ownerResponseText: replyText,
    });
  });

  const ingest = deps.ingest ?? ingestGoogleReviews;
  if (batch.length > 0) {
    const result = await ingest(batch, {
      parserVersion: GBP_PARSER_VERSION,
      credentialId: GBP_CREDENTIAL_ID,
      ingestionSource: "gbp_api",
    });
    report.filed = {
      created: result.created,
      updated: result.updated,
      countedIntoPeriod: result.countedIntoPeriod,
      storedAsHistorical: result.storedAsHistorical,
    };
  }

  /* Links: known rows by id; just-created rows are looked up by the id they were filed under. */
  const newIds = fileable.filter((d) => d.kind === "new").map((d) => d.official.gbpReviewId);
  const createdRows = await deps.store.lookupIdsByExternalId(mapping.locationId, newIds);

  const links: LinkInput[] = [];
  for (const decision of fileable) {
    const { official } = decision;
    const reviewId =
      decision.kind === "new" ? createdRows.get(official.gbpReviewId) : decision.stored.id;
    if (!reviewId) continue;
    links.push({
      reviewId,
      gbpReviewId: official.gbpReviewId,
      gbpReviewName: official.gbpReviewName,
      method: decision.kind === "new" ? "created_from_gbp" : decision.kind === "auto_match" ? "auto_match" : "exact_id",
      createTime: official.createTime,
      updateTime: official.updateTime,
      reviewerName: official.reviewerName,
      rating: official.rating,
      comment: official.comment,
      replyText: official.replyText,
      replyUpdateTime: official.replyUpdateTime,
    });
  }
  report.links = await deps.store.applyLinks(links);

  const items: ReviewItemInput[] = decisions
    .filter((d): d is Extract<Decision, { kind: "needs_review" }> => d.kind === "needs_review")
    .map((d) => ({
      locationId: mapping.locationId,
      gbpReviewId: d.official.gbpReviewId,
      reasons: d.reasons,
      candidateReviewIds: d.candidates.map((c) => c.id),
      official: {
        reviewer: d.official.reviewerName,
        rating: d.official.rating,
        createTime: d.official.createTime,
        comment: d.official.comment ? d.official.comment.slice(0, 500) : null,
      },
    }));
  await deps.store.recordReviewItems(items);
}
