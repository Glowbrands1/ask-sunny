import "server-only";

import { ingestGoogleReviews } from "../ingest";
import type { IncomingGoogleReview, ReviewSyncResult } from "../types";
import type { GbpClient } from "./client";
import {
  isProductionRuntime,
  liveBackfillAllowed,
  newReviewCreation,
  readSyncMode,
  type GbpLimits,
  type GbpSyncMode,
} from "./config";
import { GbpApiError } from "./http";
import { normaliseOfficialReview, toIncoming, type OfficialReview } from "./normalise";
import { planPeriodAssignment } from "../period-assignment";
import { buildRunSummary } from "./summary";
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
  /**
   * A reporting window over the official review's CREATE time (inclusive start,
   * exclusive end, `YYYY-MM-DD`). It changes nothing about what is filed: it only
   * adds an `inWindow` summary to the report, so a backfill such as September–
   * October 2026 can be sized and checked before anything is written.
   */
  window?: { from: string; to: string };
}

export interface SyncDeps {
  client: GbpClient;
  store: GbpStore;
  limits: GbpLimits;
  /** The active connection, for recording that it was used. Optional in tests. */
  connectionId?: string;
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
  /**
   * COMPLETE only if every page was read, every review was understood, and
   * Google's own total is not larger than what was read (Ask Bubbles' rule).
   * An incomplete read never supports a conclusion about what is missing.
   */
  complete: boolean;
  skippedInvalid: number;
  /** Reviews whose resource name did not belong to the requested listing. Always refused. */
  resourceMismatch: number;
  alreadyLinked: number;
  autoMatched: number;
  newReviews: number;
  /** Official reviews nothing stored resembles, reported but not filed (enrich-only). */
  deferredNewReviews: number;
  needsReview: number;
  unmatchedStored: number;
  storedTotal: number;
  googleTotal: number | null;
  googleAverage: number | null;
  storedAverage: number | null;
  /** Official reviews by creation month (YYYY-MM), and the ones nothing stored resembles. */
  googleByMonth: Record<string, number>;
  missingByMonth: Record<string, number>;
  /** Present only when a window was requested. */
  inWindow?: { google: number; alreadyHeld: number; missing: number; needsReview: number };
  /**
   * WHAT FULL FILING WOULD DO, computed with the real period planner against the
   * listing's current anchor and never written. This is the evidence for the
   * cutover decision: how many reviews would start counting, and why not.
   */
  projectedIfFull?: { counted: number; historical: number; finding: string | null };
  discrepancies: Discrepancy[];
  needsReviewItems: (ReviewExcerpt & { reasons: string[]; candidateIds: string[] })[];
  newItems: ReviewExcerpt[];
  filed?: { created: number; updated: number; countedIntoPeriod: number; storedAsHistorical: number };
  links?: { linked: number; refreshed: number; conflicts: number };
}

export interface SyncReport {
  mode: "dry_run" | "live";
  scope: SyncScope;
  status: "disabled" | "succeeded" | "partial" | "failed" | "refused" | "busy";
  reason?: string;
  /**
   * ENRICH-ONLY files known reviews with NO feed position, which the period
   * planner provably treats as history (it can neither count a review nor move
   * an anchor). FULL files newly created reviews with positions and so can
   * count them; it needs GBP_CREATE_NEW_REVIEWS and Apify off.
   */
  filing: "enrich_only" | "full";
  forcedDryRunReason?: string;
  /** Summed over listings; present only when a window was requested. */
  window?: { from: string; to: string; google: number; alreadyHeld: number; missing: number; needsReview: number };
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
    complete: false,
    skippedInvalid: 0,
    resourceMismatch: 0,
    alreadyLinked: 0,
    autoMatched: 0,
    newReviews: 0,
    deferredNewReviews: 0,
    needsReview: 0,
    unmatchedStored: 0,
    storedTotal: 0,
    googleTotal: null,
    googleAverage: null,
    storedAverage: null,
    discrepancies: [],
    needsReviewItems: [],
    newItems: [],
    googleByMonth: {},
    missingByMonth: {},
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

  const creation = newReviewCreation(env);
  const filing: "enrich_only" | "full" = creation.allowed ? "full" : "enrich_only";

  const base = {
    filing,
    scope: options.scope,
    requests: 0,
    locations: [] as LocationReport[],
    totals: { fetched: 0, alreadyLinked: 0, autoMatched: 0, newReviews: 0, needsReview: 0, failedLocations: 0 },
  };

  if (envMode === "off") {
    return { ...base, mode: "dry_run", status: "disabled", reason: "GBP_SYNC_MODE is off." };
  }

  /* The environment can lower the mode, never raise it: dry_run in env forces a dry run. */
  let mode: "dry_run" | "live" = envMode === "live" && options.requestedMode === "live" ? "live" : "dry_run";
  let forcedDryRunReason: string | undefined;
  if (mode === "live" && !isProductionRuntime(env)) {
    /* Preview shares the production database; only a production deployment may write. */
    mode = "dry_run";
    forcedDryRunReason = "Not a production deployment (VERCEL_ENV); live writes are refused.";
  }

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

  const fileNew = creation.allowed;
  /* ONE live run at a time, enforced by Postgres. A dry run writes nothing and so takes no lock. */
  let runId: string | null = null;
  if (mode === "live") {
    runId = await deps.store.claimRun({ scope: options.scope, trigger: options.trigger });
    if (!runId) {
      return { ...base, mode, status: "busy", reason: "Another Business Profile sync is running.", forcedDryRunReason };
    }
    if (deps.connectionId) await deps.store.touchConnection(deps.connectionId).catch(() => undefined);
  }

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
      await syncLocation(mapping, report, mode, maxPages, deps, fileNew, options.window);
    } catch (error) {
      report.status = "failed";
      if (error instanceof GbpApiError) {
        report.errorCode = error.code;
        /* Revoked auth, an unapproved API and an exhausted budget fail every listing alike. */
        if (
          error.code === "auth_revoked" ||
          error.code === "auth_failed" ||
          error.code === "forbidden" ||
          error.code === "api_disabled" ||
          error.code === "api_access_pending" ||
          error.code === "request_budget_exceeded"
        ) {
          fatal = error;
          /* A dead grant is recorded so the screen can say "reconnect", not "Google is down". */
          if (mode === "live" && error.code === "auth_revoked") {
            await deps.store.endConnection("expired", "invalid_grant", `system:${options.trigger}`).catch(() => undefined);
          }
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
  const windowTotals = options.window
    ? locations.reduce(
        (sum, l) => ({
          ...sum,
          google: sum.google + (l.inWindow?.google ?? 0),
          alreadyHeld: sum.alreadyHeld + (l.inWindow?.alreadyHeld ?? 0),
          missing: sum.missing + (l.inWindow?.missing ?? 0),
          needsReview: sum.needsReview + (l.inWindow?.needsReview ?? 0),
        }),
        { ...options.window, google: 0, alreadyHeld: 0, missing: 0, needsReview: 0 },
      )
    : undefined;
  const report: SyncReport = {
    mode,
    filing,
    window: windowTotals,
    forcedDryRunReason,
    scope: options.scope,
    status,
    requests: deps.client.requestCount,
    locations,
    totals,
  };

  const summary = buildRunSummary(report);
  const runStatus = status === "failed" ? "failed" : status === "partial" ? "partial" : "succeeded";
  if (mode === "live") {
    await deps.store.finishRun(runId, {
      status: runStatus,
      requests: report.requests,
      /* Counts and codes only — no review text and no names. */
      summary,
      errorCode: fatal ? (fatal as GbpApiError).code : null,
    });
  } else if (options.trigger === "admin" || options.trigger === "cron") {
    /*
     * A DRY RUN WRITES NO REVIEW DATA — no review row, no link, no queue item.
     * It records ONE counts-only ledger row, so "what did the last check find"
     * is a fact the screen can show after a reload and the cutover checklist can
     * read. Best effort: a ledger failure never fails the check.
     */
    await deps.store
      .recordRun({ mode: "dry_run", scope: options.scope, trigger: options.trigger, status: runStatus, requests: report.requests, summary, errorCode: fatal ? (fatal as GbpApiError).code : null })
      .catch(() => undefined);
  }

  return report;
}

async function syncLocation(
  mapping: MappedLocation,
  report: LocationReport,
  mode: "dry_run" | "live",
  maxPages: number,
  deps: SyncDeps,
  fileNew: boolean,
  window?: { from: string; to: string },
): Promise<void> {
  const fetched = await deps.client.listReviews(mapping.accountName, mapping.gbpLocationName, maxPages);
  const stored = await deps.store.readStoredReviews(mapping.locationId);

  const officials: OfficialReview[] = [];
  for (const raw of fetched.reviews) {
    const outcome = normaliseOfficialReview(raw, mapping.storeCode, {
      accountName: mapping.accountName,
      locationName: mapping.gbpLocationName,
    });
    if (outcome.ok) officials.push(outcome.review);
    else if (outcome.code === "resource_mismatch") report.resourceMismatch += 1;
    else report.skippedInvalid += 1;
  }

  /* A review listed twice across pages is one review. */
  const unique = [...new Map(officials.map((o) => [o.gbpReviewId, o] as const)).values()];

  const plan = reconcileLocation(unique, stored);

  report.fetched = unique.length;
  report.truncated = fetched.truncated;
  report.complete =
    !fetched.truncated &&
    report.skippedInvalid === 0 &&
    report.resourceMismatch === 0 &&
    (fetched.totalReviewCount === null || unique.length >= fetched.totalReviewCount);
  report.storedTotal = stored.length;
  report.googleTotal = fetched.totalReviewCount;
  report.googleAverage = fetched.averageRating;
  report.storedAverage = stored.length
    ? Math.round((stored.reduce((sum, s) => sum + s.rating, 0) / stored.length) * 100) / 100
    : null;
  report.discrepancies = plan.discrepancies;
  /* Only meaningful when the whole feed was read. */
  report.unmatchedStored = report.complete ? plan.unmatchedStored.length : 0;

  for (const decision of plan.decisions) {
    if (decision.kind === "linked") report.alreadyLinked += 1;
    else if (decision.kind === "auto_match") report.autoMatched += 1;
    else if (decision.kind === "new") {
      report.newReviews += 1;
      if (!fileNew) report.deferredNewReviews += 1;
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

  /* Size the gap by month, and over a requested window, without filing anything. */
  const month = (iso: string | null) => (iso ? iso.slice(0, 7) : "unknown");
  for (const official of unique) {
    const m = month(official.createTime);
    report.googleByMonth[m] = (report.googleByMonth[m] ?? 0) + 1;
  }
  for (const decision of plan.decisions) {
    if (decision.kind !== "new") continue;
    const m = month(decision.official.createTime);
    report.missingByMonth[m] = (report.missingByMonth[m] ?? 0) + 1;
  }
  if (window) {
    const start = Date.parse(`${window.from}T00:00:00Z`);
    const end = Date.parse(`${window.to}T00:00:00Z`);
    const summary = { google: 0, alreadyHeld: 0, missing: 0, needsReview: 0 };
    for (const decision of plan.decisions) {
      const at = decision.official.createTime ? Date.parse(decision.official.createTime) : NaN;
      if (Number.isNaN(at) || at < start || at >= end) continue;
      summary.google += 1;
      if (decision.kind === "linked" || decision.kind === "auto_match") summary.alreadyHeld += 1;
      else if (decision.kind === "new") summary.missing += 1;
      else summary.needsReview += 1;
    }
    report.inWindow = summary;
  }

  /* Evidence for the cutover decision. Read-only: the real planner, the real anchor, nothing written. */
  const projected = buildBatch(mapping, fileableOf(plan.decisions, true), true);
  const anchor = await deps.store.readAnchor(mapping.storeCode);
  const projection = planPeriodAssignment(
    projected.map((r) => ({
      externalReviewId: r.externalReviewId,
      storeCode: r.storeCode,
      feedPosition: r.feedPosition ?? null,
      relativeDateText: null,
      publishedAt: r.googleAbsoluteDate ?? null,
    })),
    new Map([[mapping.storeCode, anchor]]),
  );
  const storePlan = projection.storePlans[0];
  report.projectedIfFull = storePlan
    ? { counted: storePlan.counted, historical: storePlan.historical, finding: storePlan.finding }
    : { counted: 0, historical: 0, finding: null };

  if (mode === "dry_run") return;

  await fileLive(mapping, report, plan.decisions, deps, fileNew);
}


type Fileable = Exclude<Decision, { kind: "needs_review" }>;

function fileableOf(decisions: Decision[], includeNew: boolean): Fileable[] {
  return decisions
    .filter((d): d is Fileable => d.kind !== "needs_review")
    .filter((d) => includeNew || d.kind !== "new")
    .sort((a, b) => byNewest(a.official, b.official));
}

function buildBatch(mapping: MappedLocation, fileable: Fileable[], withPositions: boolean): IncomingGoogleReview[] {
  return fileable.map((decision, index) => {
    const position = withPositions ? index : null;
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
}

async function fileLive(
  mapping: MappedLocation,
  report: LocationReport,
  decisions: Decision[],
  deps: SyncDeps,
  fileNew: boolean,
): Promise<void> {
  /*
   * ENRICH-ONLY (the default while Apify runs): brand-new reviews are NOT
   * created, and known reviews are filed with NO feed position. A store batch
   * containing any null position is marked historical by the period planner —
   * it cannot count a review or advance an anchor — so this path cannot change
   * a reporting assignment. FULL mode (positions, creation) is the post-Apify
   * cutover behaviour.
   */
  const fileable = fileableOf(decisions, fileNew);

  const batch = buildBatch(mapping, fileable, fileNew);

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
  /* A stable order, so two writers touching the same rows lock them in the same sequence. */
  links.sort((a, b) => a.reviewId.localeCompare(b.reviewId));
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
