import "server-only";

import { AiError } from "@/lib/ai/errors";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ingestGoogleReviews, MAX_REVIEWS_PER_SYNC } from "../ingest";
import type { IncomingGoogleReview } from "../types";
import {
  fetchDatasetItems,
  getRun,
  runInProgress,
  runSucceeded,
  startRun,
  type ApifyRun,
} from "./client";
import { readApifyConfig, type ApifyConfig } from "./config";
import {
  assignPlaces,
  readLocationMappings,
  selectRunnableLocations,
  verifyPlaceCandidate,
} from "./locations";
import { buildSearchQuery, resolveDiscovery, type DiscoveryOutcome } from "./discovery";
import { normaliseApifyDataset, readPlaceFacts } from "./normalise";
import type { ApifyLocationMapping, ApifyRunKind, ApifyTriggerResult } from "./types";

/**
 * ============================================================================
 * THE SERVER-SIDE SYNC — starting a run, and filing what it returned
 * ============================================================================
 *
 * ============================================================================
 * THE SHAPE, AND WHY IT IS NOT A POLLING LOOP
 * ============================================================================
 *
 *   ASK Sunny decides WHAT to ask for      — from the verified mapping, here
 *   Apify runs the Actor                   — on Apify's compute, not ours
 *   Apify calls back when the run finishes — an ad-hoc webhook on that run
 *   ASK Sunny fetches the dataset itself   — with its own token, server-side
 *   ASK Sunny normalises and upserts       — through the existing ingestion
 *
 * Two designs were available. Letting APIFY hold the schedule and the input
 * would mean the fifteen-location mapping living in two places, and the one on
 * Apify would be the one a scheduled run actually used — so a salon corrected
 * here would keep being scraped wrong. Having ASK SUNNY poll a started run
 * would spend an invocation per check and, done badly, a run per check.
 *
 * So ASK Sunny owns the input and Apify owns the waiting. Nothing sleeps,
 * nothing retries on a timer, and the only read of a run's state outside the
 * webhook is the single reconciliation check below, over runs whose webhook
 * never arrived.
 *
 * ============================================================================
 * WHAT A FAILED RUN MAY DO, WHICH IS NOTHING
 * ============================================================================
 *
 * Every write in this file is an INSERT or an UPDATE through
 * `ingest_google_reviews`. There is no delete, no truncate, and no "replace the
 * listing's reviews with what came back" — so a run that fails, times out,
 * returns an empty dataset or returns a dataset for three of fifteen listings
 * leaves every existing review exactly where it was. A partial run files what
 * it got and names the listings that did not answer.
 */

/**
 * WHICH CODE READ THE RECORDS, stored on every review as `parser_version`.
 *
 * Deliberately the NORMALISER's version and not the Actor's: it is what says
 * which rows to re-check when a field starts coming back wrong on our side.
 * Which Actor produced them is recorded once per run, on the run ledger, which
 * is where a question about the Actor belongs.
 */
export const APIFY_NORMALISER_VERSION = "apify-normaliser-1";

/** The audit label a scheduled run files under. Never a secret. */
export const CRON_REQUESTER = "cron";

/* ------------------------------------------------------- the actor input -- */

export interface ActorInput {
  placeIds: string[];
  maxReviews: number;
  reviewsSort: "newest";
  language: string;
  personalData: boolean;
  reviewsStartDate?: string;
}

/**
 * What this system asks the Actor for.
 *
 * A pure function, because it is the thing most likely to need changing when
 * the Actor is swapped and the thing least pleasant to debug from a log. Every
 * field is deliberate:
 *
 *   `reviewsSort: "newest"` — the anchor model measures a review's position
 *   against the last one counted, so a feed that is not newest-first proves
 *   nothing. A run sorted any other way is refused downstream by
 *   `feedOrderLooksReliable` rather than miscounted.
 *
 *   `maxReviews` — the per-location ceiling, and the first of the three cost
 *   guardrails. The second is the run's `maxItems`; the third is the daily run
 *   count, enforced in the database.
 *
 *   `reviewsStartDate` — the date cutoff, sent only when every listing already
 *   holds reviews. It is what turns a recurring run from "fetch fifteen
 *   windows" into "fetch what is new", and it is the difference between a
 *   demo that fits in the free allowance and one that does not.
 *
 *   `personalData: true` — the reviewer's display name is the label a salon
 *   manager recognises and the dashboard's most-read field. Nothing beyond the
 *   name is stored: no profile URL, no reviewer id, no photo.
 */
export function buildActorInput(options: {
  placeIds: readonly string[];
  maxReviews: number;
  reviewsSince: string | null;
}): ActorInput {
  const input: ActorInput = {
    placeIds: [...options.placeIds],
    maxReviews: options.maxReviews,
    reviewsSort: "newest",
    language: "en",
    personalData: true,
  };

  if (options.reviewsSince) input.reviewsStartDate = options.reviewsSince;

  return input;
}

/** What the places Actor is asked, one search string per salon. */
export interface DiscoveryActorInput {
  searchStringsArray: string[];
  maxCrawledPlacesPerSearch: number;
  language: string;
  countryCode: string;
  /* A closed listing is still worth SEEING — it explains a salon we cannot map. */
  skipClosedPlaces: false;
}

/**
 * The discovery run's input.
 *
 * ONE SEARCH STRING PER SALON, built from the roster by `buildSearchQuery`:
 * the brand, the street hint where the roster carries one, then the city and
 * state. A listing with no expected city and state produces no query and is
 * simply not searched for — there would be nothing to check the answer against.
 *
 * `maxCrawledPlacesPerSearch` is the cost knob AND a safety feature. Returning
 * only the top hit would hide the second Sun Tan City in the same city, turning
 * a genuine ambiguity into a confident wrong answer; five results per salon is
 * what makes `ambiguous` detectable.
 */
export function buildDiscoveryInput(options: {
  locations: readonly ApifyLocationMapping[];
  candidatesPerLocation: number;
}): DiscoveryActorInput {
  const queries = options.locations
    .map((location) => buildSearchQuery(location))
    .filter((query): query is string => query !== null);

  return {
    searchStringsArray: queries,
    maxCrawledPlacesPerSearch: options.candidatesPerLocation,
    language: "en",
    countryCode: "us",
    skipClosedPlaces: false,
  };
}

/**
 * The date cutoff for a recurring run, or null.
 *
 * THE MINIMUM ACROSS LISTINGS, NOT THE MAXIMUM. A cutoff taken from the newest
 * review anywhere in the estate would silently skip everything a slower salon
 * received in between. The oldest "newest review" is the only cutoff that
 * cannot lose a review from any listing.
 *
 * NULL WHEN ANY LISTING HOLDS NOTHING, because a listing with no reviews has no
 * floor to measure from, and there is no cutoff that is safe for it. Those runs
 * are bounded by `maxReviews` alone, which is the correct trade: the first run
 * or two costs a little more and nothing is missed.
 */
export function incrementalCutoff(
  locations: readonly ApifyLocationMapping[],
  overlapHours: number,
  now: number = Date.now(),
): string | null {
  if (locations.length === 0) return null;

  let oldest: number | null = null;

  for (const location of locations) {
    if (!location.latestPublishedAt) return null;
    const parsed = Date.parse(location.latestPublishedAt);
    if (Number.isNaN(parsed)) return null;
    oldest = oldest === null ? parsed : Math.min(oldest, parsed);
  }

  if (oldest === null) return null;

  const cutoff = oldest - overlapHours * 3_600_000;
  /* A cutoff in the future would ask for nothing at all. */
  return new Date(Math.min(cutoff, now)).toISOString();
}

/* --------------------------------------------------------- starting a run - */

interface ClaimOutcome {
  status: "claimed" | "already_running" | "over_budget";
  runId?: string;
  startedAt?: string;
  requestedBy?: string;
  runsInWindow?: number;
  limit?: number;
}

async function claimRun(
  config: ApifyConfig,
  kind: ApifyRunKind,
  requestedBy: string,
  locations: number,
  limit: number,
  since: string | null,
): Promise<ClaimOutcome> {
  const { data, error } = await getSupabaseAdmin().rpc("google_review_apify_claim_run", {
    p_kind: kind,
    p_requested_by: requestedBy,
    p_locations: locations,
    p_limit: limit,
    p_since: since,
    p_max_runs_per_day: config.maxRunsPerDay,
  });

  if (error) {
    console.error("[reviews/apify] could not claim a run slot", error.code ?? "unknown");
    throw new AiError(
      "bad_request",
      "The sync could not be started. Nothing has been changed.",
      502,
    );
  }

  return (data ?? { status: "over_budget" }) as ClaimOutcome;
}

async function releaseRun(runId: string, code: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("google_review_apify_release_run", {
    p_run_id: runId,
    p_status: "failed",
    p_problems: [{ code }],
  });
  if (error) {
    console.error("[reviews/apify] could not release the run slot", error.code ?? "unknown");
  }
}

/**
 * The webhook Apify calls when the run it is attached to finishes.
 *
 * ============================================================================
 * THE SECRET GOES IN A HEADER, AND IT IS NOT THE ONLY CHECK
 * ============================================================================
 *
 * `headersTemplate` carries `APIFY_WEBHOOK_SECRET`, so a request that does not
 * present it is refused before anything is read. But a shared secret held by a
 * third party is one check, not a security model, so the route applies two
 * more: the run id in the body must name a run THIS SYSTEM STARTED and is
 * still waiting on, and the dataset is then read from Apify's own API rather
 * than from anything the caller said. A forged webhook's best outcome is
 * making us re-read a dataset we already own.
 *
 * `{{…}}` is Apify's interpolation, not a template literal — the braces reach
 * Apify verbatim and are filled in by Apify at delivery time.
 */
function webhookRequest(
  baseUrl: string,
  askSunnyRunId: string,
  secret: string | null,
): { eventTypes: string[]; requestUrl: string; payloadTemplate: string; headersTemplate?: string } {
  return {
    /*
     * FAILURE IS SUBSCRIBED TO AS WELL AS SUCCESS. A run that fails silently
     * leaves the lock held until the reaper clears it six hours later, and the
     * status panel showing "running" for an afternoon is exactly the kind of
     * ambiguity this integration is supposed to remove.
     */
    eventTypes: [
      "ACTOR.RUN.SUCCEEDED",
      "ACTOR.RUN.FAILED",
      "ACTOR.RUN.TIMED_OUT",
      "ACTOR.RUN.ABORTED",
    ],
    requestUrl: `${baseUrl.replace(/\/+$/, "")}/api/reviews/apify/webhook`,
    payloadTemplate: JSON.stringify({
      askSunnyRunId,
      eventType: "{{eventType}}",
      apifyRunId: "{{resource.id}}",
      status: "{{resource.status}}",
    }),
    ...(secret
      ? { headersTemplate: JSON.stringify({ authorization: `Bearer ${secret}` }) }
      : {}),
  };
}

export interface StartSyncOptions {
  kind: ApifyRunKind;
  /** `cron`, or `admin:<email>` from a verified session. Never a secret. */
  requestedBy: string;
  /** Where Apify should call back. Absolute, https, and never carries a token. */
  baseUrl: string;
  webhookSecret: string | null;
}

/**
 * Start one controlled Apify run.
 *
 * THE LOCK IS TAKEN BEFORE APIFY IS TOUCHED, and released as a failure if
 * anything after it throws. That ordering is what makes the manual button safe
 * to double-click: the second click loses the race inside Postgres and is told
 * a run is already going, rather than starting a second one and paying twice.
 */
export async function startApifySync(options: StartSyncOptions): Promise<ApifyTriggerResult> {
  const config = readApifyConfig();

  if (!config.enabled) {
    return {
      status: "disabled",
      runId: null,
      apifyRunId: null,
      kind: null,
      locationsRequested: 0,
      reviewsLimitPerLocation: null,
      message:
        "Server-side Google review sync is switched off. Set APIFY_SYNC_ENABLED to true to turn it on.",
    };
  }

  if (!config.token) {
    return {
      status: "not_configured",
      runId: null,
      apifyRunId: null,
      kind: null,
      locationsRequested: 0,
      reviewsLimitPerLocation: null,
      message: "APIFY_TOKEN is not set for this deployment, so no run can be started.",
    };
  }

  const mappings = await readLocationMappings();

  /*
   * A VERIFICATION RUN LOOKS AT A DIFFERENT SET, WHICH IS THE POINT.
   *
   * Every other run reads only listings that are already `verified`, because a
   * listing whose Google identity nobody has confirmed must not have reviews
   * filed against it. That fail-closed rule would also make verification
   * impossible — a pending listing could never be checked — so the resolution
   * run, and only it, reads the pending ones. It asks for a single review each,
   * uses the place facts that come back to confirm Google's name and address
   * against the roster, and writes `verified` or `rejected`. It files no review.
   */
  const resolving = options.kind === "location_resolution";

  /*
   * A DISCOVERY RUN LOOKS AT EVERY LISTING THAT IS NOT ALREADY SETTLED.
   *
   * It is the one run that must work on listings with NO Google identifier —
   * finding the identifier is the job. A listing that is already `verified` is
   * excluded, so pressing Discover again cannot disturb a salon somebody has
   * signed off, and the database refuses it a second time regardless.
   */
  const discovering = options.kind === "location_discovery";

  const undiscovered = mappings.filter(
    (mapping) => mapping.isActive && mapping.sourceStatus !== "verified",
  );

  const pending = mappings.filter(
    (mapping) =>
      mapping.isActive &&
      mapping.googlePlaceId !== null &&
      mapping.sourceStatus === "pending_verification",
  );

  const runnable = selectRunnableLocations(mappings);

  const locations = discovering ? undiscovered : resolving ? pending : runnable.locations;
  const placeToStoreCode = discovering
    ? new Map<string, string>()
    : resolving
      ? new Map(pending.map((mapping) => [mapping.googlePlaceId as string, mapping.storeCode]))
      : runnable.placeToStoreCode;

  if (locations.length === 0) {
    return {
      status: "not_configured",
      runId: null,
      apifyRunId: null,
      kind: null,
      locationsRequested: 0,
      reviewsLimitPerLocation: null,
      message: discovering
        ? "Every listing is already verified, so there is nothing left to discover."
        : resolving
          ? "No Google listing is waiting to be verified. Paste a Place ID or Maps URL for a listing first."
          : "No Google listing has a verified Place ID yet, so there is nothing to sync. Map the locations first.",
    };
  }

  /*
   * ONE REVIEW PER LISTING IS ALL A VERIFICATION NEEDS. The place facts —
   * Google's own title and address — ride along on the review record, so the
   * cheapest possible run answers the question.
   */
  const limit = discovering
    ? config.discoveryCandidatesPerLocation
    : resolving
      ? 1
      : options.kind === "backfill"
        ? config.backfillLimitPerLocation
        : config.incrementalLimitPerLocation;

  /*
   * A BACKFILL DELIBERATELY SENDS NO CUTOFF. Its whole purpose is to reach back
   * past what we hold, and a cutoff derived from what we hold would defeat it.
   * The bound on a backfill is `maxReviews` and nothing else, which is why it
   * is manual, one-off, and has its own smaller-by-default limit.
   */
  const since =
    options.kind === "incremental"
      ? incrementalCutoff(locations, config.overlapHours)
      : null;

  const claim = await claimRun(
    config,
    options.kind,
    options.requestedBy,
    locations.length,
    limit,
    since,
  );

  if (claim.status === "already_running") {
    return {
      status: "already_running",
      runId: claim.runId ?? null,
      apifyRunId: null,
      kind: null,
      locationsRequested: 0,
      reviewsLimitPerLocation: null,
      message:
        "A Google review sync is already running. Wait for it to finish — starting a second one would scrape and pay for the same reviews twice.",
    };
  }

  if (claim.status === "over_budget") {
    return {
      status: "over_budget",
      runId: null,
      apifyRunId: null,
      kind: null,
      locationsRequested: 0,
      reviewsLimitPerLocation: null,
      message: `The daily Apify run limit (${claim.limit ?? config.maxRunsPerDay}) has been reached, so no run was started. Raise APIFY_MAX_RUNS_PER_DAY if this is expected.`,
    };
  }

  const runId = claim.runId as string;

  /*
   * A DISCOVERY RUN SAYS WHICH LISTINGS IT COVERS BEFORE IT STARTS, so the
   * review table reads `Searching` while Apify works rather than showing the
   * previous run's answer as if it were current.
   */
  if (discovering) {
    const { error } = await getSupabaseAdmin().rpc("google_review_apify_mark_searching", {
      p_store_codes: locations.map((location) => location.storeCode),
    });
    if (error) {
      console.error("[reviews/apify] could not mark listings searching", error.code ?? "unknown");
    }
  }

  let run: ApifyRun;
  try {
    run = await startRun(config, {
      input: discovering
        ? buildDiscoveryInput({ locations, candidatesPerLocation: limit })
        : buildActorInput({
            placeIds: [...placeToStoreCode.keys()],
            maxReviews: limit,
            reviewsSince: since,
          }),
      limitPerLocation: limit,
      locations: locations.length,
      webhooks: [webhookRequest(options.baseUrl, runId, options.webhookSecret)],
      ...(discovering ? { actorId: config.placesActorId } : {}),
    });
  } catch (error) {
    /*
     * THE SLOT IS RELEASED, NOT LEFT HELD. Apify refusing a run must not lock
     * the estate out of syncing until the six-hour reaper wakes up.
     */
    await releaseRun(runId, "actor_start_failed");
    throw error;
  }

  const { error } = await getSupabaseAdmin().rpc("google_review_apify_attach_run", {
    p_run_id: runId,
    p_apify_run: run.id,
    p_actor_id: config.actorId,
    p_dataset_id: run.defaultDatasetId,
  });
  if (error) {
    console.error("[reviews/apify] could not record the Apify run id", error.code ?? "unknown");
  }

  return {
    status: "started",
    runId,
    apifyRunId: run.id,
    kind: options.kind,
    locationsRequested: locations.length,
    reviewsLimitPerLocation: limit,
    message: discovering
      ? `Searching Google Maps for ${locations.length} location${
          locations.length === 1 ? "" : "s"
        }. Nothing will be mapped automatically — you confirm the matches.`
      : resolving
      ? `Checking ${locations.length} Google listing${
          locations.length === 1 ? "" : "s"
        } against the roster. No review will be imported by this run.`
      : `Started a ${options.kind} run over ${locations.length} location${
          locations.length === 1 ? "" : "s"
        }, up to ${limit} review${limit === 1 ? "" : "s"} each.`,
  };
}

/* ------------------------------------------------------ finishing a run --- */

export interface CompletionResult {
  status: "succeeded" | "partial" | "failed" | "ignored";
  reviewsFetched: number;
  created: number;
  updated: number;
  duplicates: number;
  countedIntoPeriod: number;
  storedAsHistorical: number;
  locationsReturned: number;
  missingStoreCodes: string[];
  message: string;
}

interface LedgerRow {
  id: string;
  apify_run_id: string | null;
  status: string;
  kind: ApifyRunKind;
  locations_requested: number;
}

async function readLedgerRun(runId: string): Promise<LedgerRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("google_review_apify_runs")
    .select("id,apify_run_id,status,kind,locations_requested")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    console.error("[reviews/apify] could not read the run ledger", error.code ?? "unknown");
    throw new AiError("bad_request", "The Apify run could not be read.", 502);
  }

  return (data ?? null) as LedgerRow | null;
}

async function recordOutcome(
  runId: string,
  status: "succeeded" | "partial" | "failed",
  counts: Record<string, number>,
  missing: string[],
  problems: { code: string; storeCode?: string }[],
  usageUsd: number | null,
  syncRunId: string | null,
): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("google_review_apify_record_outcome", {
    p_run_id: runId,
    p_status: status,
    p_counts: counts,
    p_missing: missing,
    p_problems: problems,
    p_usage_usd: usageUsd,
    p_sync_run: syncRunId,
  });

  if (error) {
    console.error("[reviews/apify] could not record the run outcome", error.code ?? "unknown");
  }
}

/**
 * Split a run's reviews into batches the ingestion will accept.
 *
 * ONE LISTING IS NEVER SPLIT. Feed positions are only comparable within a
 * batch, because that is the unit the anchor plan is measured over — so a
 * listing divided across two batches would have its boundary fall inside the
 * split and count the wrong half. The per-location limit is bounded to the
 * batch size precisely so this is always possible.
 */
export function batchByStore(
  reviews: readonly IncomingGoogleReview[],
  maxPerBatch: number = MAX_REVIEWS_PER_SYNC,
): IncomingGoogleReview[][] {
  const byStore = new Map<string, IncomingGoogleReview[]>();
  for (const review of reviews) {
    byStore.set(review.storeCode, [...(byStore.get(review.storeCode) ?? []), review]);
  }

  const batches: IncomingGoogleReview[][] = [];
  let current: IncomingGoogleReview[] = [];

  for (const group of byStore.values()) {
    if (current.length > 0 && current.length + group.length > maxPerBatch) {
      batches.push(current);
      current = [];
    }
    current.push(...group);
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * File what a finished run returned.
 *
 * ============================================================================
 * APIFY IS ASKED WHAT HAPPENED; THE CALLER IS NOT BELIEVED
 * ============================================================================
 *
 * The webhook says a run finished. This function asks Apify's API whether that
 * is true, which run it was and which dataset holds the records, and reads the
 * records with this system's own token. Nothing about the review data comes
 * from the request body — so the worst a forged, correctly-authenticated
 * webhook can do is make us re-read a dataset we started and already own,
 * which is idempotent by construction.
 */
export async function completeApifyRun(askSunnyRunId: string): Promise<CompletionResult> {
  const config = readApifyConfig();
  const ledger = await readLedgerRun(askSunnyRunId);

  if (!ledger) {
    /*
     * A RUN WE DID NOT START. Reported as ignored rather than as an error: it
     * is what a replayed webhook from a deleted run looks like, and nothing
     * about it needs fixing.
     */
    return {
      status: "ignored",
      reviewsFetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
      locationsReturned: 0,
      missingStoreCodes: [],
      message: "No such run.",
    };
  }

  if (ledger.status !== "running") {
    /* Already settled — a duplicate delivery. Idempotent by doing nothing. */
    return {
      status: "ignored",
      reviewsFetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
      locationsReturned: 0,
      missingStoreCodes: [],
      message: "That run has already been recorded.",
    };
  }

  if (!ledger.apify_run_id) {
    await recordOutcome(askSunnyRunId, "failed", {}, [], [{ code: "no_apify_run_id" }], null, null);
    return {
      status: "failed",
      reviewsFetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
      locationsReturned: 0,
      missingStoreCodes: [],
      message: "The run was never registered with Apify. No reviews were changed.",
    };
  }

  const run = await getRun(config, ledger.apify_run_id);

  if (!run) {
    await recordOutcome(askSunnyRunId, "failed", {}, [], [{ code: "run_not_found" }], null, null);
    return {
      status: "failed",
      reviewsFetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
      locationsReturned: 0,
      missingStoreCodes: [],
      message: "Apify no longer knows about that run. No reviews were changed.",
    };
  }

  if (runInProgress(run.status)) {
    /* Apify has not finished. Nothing is concluded and the lock is kept. */
    return {
      status: "ignored",
      reviewsFetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
      locationsReturned: 0,
      missingStoreCodes: [],
      message: "The run is still going.",
    };
  }

  if (!runSucceeded(run.status)) {
    /*
     * A FAILED ACTOR RUN CHANGES NO REVIEW. There is nothing to undo, because
     * nothing was written: ingestion happens only below, after a successful run
     * produced a dataset this system could read.
     */
    await recordOutcome(
      askSunnyRunId,
      "failed",
      {},
      [],
      [{ code: `actor_run_${run.status.toLowerCase().replace(/-/g, "_")}` }],
      run.usageTotalUsd,
      null,
    );
    return {
      status: "failed",
      reviewsFetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
      locationsReturned: 0,
      missingStoreCodes: [],
      message: `The Apify run ended as ${run.status}. Every existing review is untouched.`,
    };
  }

  if (!run.defaultDatasetId) {
    await recordOutcome(
      askSunnyRunId,
      "failed",
      {},
      [],
      [{ code: "dataset_unavailable" }],
      run.usageTotalUsd,
      null,
    );
    return {
      status: "failed",
      reviewsFetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
      locationsReturned: 0,
      missingStoreCodes: [],
      message: "The Apify run succeeded but produced no readable dataset. No reviews were changed.",
    };
  }

  const mappings = await readLocationMappings();
  const { locations, placeToStoreCode } = selectRunnableLocations(mappings);

  let items: unknown[];
  try {
    items = await fetchDatasetItems(config, run.defaultDatasetId);
  } catch (error) {
    await recordOutcome(
      askSunnyRunId,
      "failed",
      {},
      [],
      [{ code: "dataset_unreadable" }],
      run.usageTotalUsd,
      null,
    );
    throw error;
  }

  /*
   * A VERIFICATION RUN ENDS HERE. It writes location mappings, never reviews —
   * so it cannot create, update, reassign or delete a single review, whatever
   * its dataset holds.
   */
  if (ledger.kind === "location_resolution") {
    return completeLocationResolution(askSunnyRunId, mappings, items, run.usageTotalUsd);
  }

  /*
   * A DISCOVERY RUN ENDS HERE TOO. It writes proposals and nothing else: it
   * cannot create, update, reassign or delete a review, and it cannot make a
   * listing runnable.
   */
  if (ledger.kind === "location_discovery") {
    return completeLocationDiscovery(askSunnyRunId, mappings, items, run.usageTotalUsd);
  }

  const normalised = normaliseApifyDataset(items, placeToStoreCode);

  /*
   * WHICH LISTINGS DID NOT COME BACK — asked for, and absent from the dataset
   * entirely. A listing that came back with zero NEW reviews is not on this
   * list, because it answered; conflating the two is how a broken mapping gets
   * read as a quiet week for six weeks running.
   */
  const returned = new Set(normalised.storeCodesReturned);
  const missing = locations
    .map((location) => location.storeCode)
    .filter((storeCode) => !returned.has(storeCode));

  let created = 0;
  let updated = 0;
  let duplicates = 0;
  let counted = 0;
  let historical = 0;
  let invalid = normalised.invalid;
  let syncRunId: string | null = null;
  const problems: { code: string; storeCode?: string }[] = normalised.problems.map((problem) => ({
    code: problem.code,
    ...(problem.storeCode ? { storeCode: problem.storeCode } : {}),
  }));

  for (const batch of batchByStore(normalised.reviews)) {
    const result = await ingestGoogleReviews(batch, {
      parserVersion: APIFY_NORMALISER_VERSION,
      credentialId: `apify:${ledger.kind}`.slice(0, 64),
      ingestionSource: "apify",
    });

    created += result.created;
    updated += result.updated;
    duplicates += result.duplicates;
    counted += result.countedIntoPeriod;
    historical += result.storedAsHistorical;
    invalid += result.invalid;
    syncRunId = result.runId ?? syncRunId;

    for (const finding of result.storeFindings) {
      problems.push({ code: finding.finding, storeCode: finding.storeCode });
    }
    problems.push(...result.problems);
  }

  /*
   * PARTIAL IS A REAL OUTCOME AND IS NAMED AS ONE. A run that answered for
   * thirteen of fifteen listings is not a success, and calling it one is how a
   * mapping that silently broke stays broken.
   */
  const status: "succeeded" | "partial" = missing.length === 0 ? "succeeded" : "partial";

  await recordOutcome(
    askSunnyRunId,
    status,
    {
      locationsReturned: returned.size,
      reviewsFetched: normalised.reviews.length,
      created,
      updated,
      duplicates,
      invalid,
      unmapped: normalised.unmapped,
      countedIntoPeriod: counted,
      storedAsHistorical: historical,
    },
    missing,
    problems.slice(0, 200),
    run.usageTotalUsd,
    syncRunId,
  );

  return {
    status,
    reviewsFetched: normalised.reviews.length,
    created,
    updated,
    duplicates,
    countedIntoPeriod: counted,
    storedAsHistorical: historical,
    locationsReturned: returned.size,
    missingStoreCodes: missing,
    message:
      status === "succeeded"
        ? `All ${locations.length} locations answered. ${created} new, ${updated} updated, ${duplicates} already held.`
        : `${returned.size} of ${locations.length} locations answered. ${created} new, ${updated} updated. Missing: ${missing.join(", ")}.`,
  };
}

/* -------------------------------------------- discovering the locations --- */

/**
 * Turn a places dataset into one proposal per listing.
 *
 * ============================================================================
 * IT PROPOSES. IT DOES NOT ATTACH.
 * ============================================================================
 *
 * Every write below goes through `google_review_apify_record_discovery`, which
 * touches only the `discovered_*` columns and `discovery_status`. It cannot set
 * `google_place_id`, cannot write `verified`, and refuses a listing that is
 * already verified. So the worst a bad search can do is put a wrong candidate
 * on screen for a person to reject — and `resolveDiscovery` will already have
 * marked it `ambiguous` if anything about it was unclear.
 *
 * A listing with NO candidate is written too, as `not_found` or `ambiguous`.
 * Leaving it silent would make "we could not find this one" and "we did not
 * look" the same row, and the second is the one that gets forgotten.
 */
export async function completeLocationDiscovery(
  askSunnyRunId: string,
  mappings: readonly ApifyLocationMapping[],
  items: readonly unknown[],
  usageUsd: number | null,
): Promise<CompletionResult> {
  const searched = mappings.filter(
    (mapping) => mapping.isActive && mapping.sourceStatus !== "verified",
  );

  const outcomes: DiscoveryOutcome[] = resolveDiscovery(searched, items);
  const admin = getSupabaseAdmin();

  const problems: { code: string; storeCode?: string }[] = [];
  const unresolved: string[] = [];
  let found = 0;

  for (const outcome of outcomes) {
    if (outcome.status === "candidate_found") found += 1;
    else {
      unresolved.push(outcome.storeCode);
      problems.push({ code: `discovery_${outcome.status}`, storeCode: outcome.storeCode });
    }

    const { error } = await admin.rpc("google_review_apify_record_discovery", {
      p_store_code: outcome.storeCode,
      p_status: outcome.status,
      p_place_id: outcome.candidate?.placeId ?? null,
      p_name: outcome.candidate?.title ?? null,
      p_address: outcome.candidate?.address ?? null,
      p_maps_url: outcome.candidate?.mapsUrl ?? null,
      p_cid: outcome.candidate?.cid ?? null,
      p_candidates: outcome.candidateCount,
      p_note: outcome.note,
      p_query: outcome.query,
    });

    if (error) {
      console.error("[reviews/apify] could not record a discovery", error.code ?? "unknown");
      problems.push({ code: "discovery_not_recorded", storeCode: outcome.storeCode });
    }
  }

  /*
   * PARTIAL WHEN ANYTHING IS UNRESOLVED, because that is what it is: the run
   * worked, and it did not answer for every salon. Calling it a success would
   * put a green label above a table with four rows nobody has looked at.
   */
  const status: "succeeded" | "partial" = unresolved.length === 0 ? "succeeded" : "partial";

  await recordOutcome(
    askSunnyRunId,
    status,
    {
      locationsReturned: found,
      reviewsFetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      invalid: 0,
      unmapped: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
    },
    unresolved,
    problems.slice(0, 200),
    usageUsd,
    null,
  );

  return {
    status,
    reviewsFetched: 0,
    created: 0,
    updated: 0,
    duplicates: 0,
    countedIntoPeriod: 0,
    storedAsHistorical: 0,
    locationsReturned: found,
    missingStoreCodes: unresolved,
    message: `${found} of ${outcomes.length} location${
      outcomes.length === 1 ? "" : "s"
    } matched a single Google listing${
      unresolved.length > 0 ? `; ${unresolved.length} need a person` : ""
    }. Nothing has been mapped yet — review and confirm.`,
  };
}

/* --------------------------------------------- verifying the locations ---- */

/**
 * Turn a verification run's dataset into `verified` / `rejected` mappings.
 *
 * ============================================================================
 * IT NEVER FILES A REVIEW, AND IT NEVER MATCHES BY NAME
 * ============================================================================
 *
 * The dataset is reduced to place FACTS — Google's own title and address, keyed
 * by the place id — and each is compared against the listing that ALREADY
 * claims that place id. Nothing here searches: the operator supplied the
 * identifier, and this checks whether the identifier is what they thought it
 * was.
 *
 * That ordering is the safety property. A resolver that took a name and went
 * looking would, on a bad day, attach a franchise location this business does
 * not operate to a real salon. This one can only ever answer "the id you gave
 * for store 306 is / is not the Manhattan salon".
 *
 * ============================================================================
 * A PLACE THAT DID NOT COME BACK STAYS PENDING
 * ============================================================================
 *
 * Not rejected. "Google did not answer for this id" and "Google answered and it
 * was the wrong business" are different facts, and marking the first as the
 * second would have somebody re-entering an identifier that was correct.
 */
export async function completeLocationResolution(
  askSunnyRunId: string,
  mappings: readonly ApifyLocationMapping[],
  items: readonly unknown[],
  usageUsd: number | null,
): Promise<CompletionResult> {
  const facts = new Map(readPlaceFacts(items).map((place) => [place.placeId, place]));

  const pending = mappings.filter(
    (mapping) =>
      mapping.isActive &&
      mapping.googlePlaceId !== null &&
      mapping.sourceStatus === "pending_verification",
  );

  const assignments = [];
  const missing: string[] = [];
  const problems: { code: string; storeCode?: string }[] = [];
  let verified = 0;
  let rejected = 0;

  for (const mapping of pending) {
    const place = facts.get(mapping.googlePlaceId as string);

    if (!place) {
      missing.push(mapping.storeCode);
      problems.push({ code: "place_not_returned", storeCode: mapping.storeCode });
      continue;
    }

    const result = verifyPlaceCandidate(
      { title: place.title, address: place.address },
      {
        expectedState: mapping.expectedState,
        expectedCity: mapping.expectedCity,
        storeCode: mapping.storeCode,
      },
    );

    if (result.outcome === "verified") verified += 1;
    else {
      rejected += 1;
      problems.push({ code: "verification_rejected", storeCode: mapping.storeCode });
    }

    assignments.push({
      storeCode: mapping.storeCode,
      placeId: mapping.googlePlaceId as string,
      status: result.outcome,
      /*
       * WHAT GOOGLE SAID, STORED EITHER WAY. On a rejection it is the evidence
       * somebody reads to work out whether the identifier was wrong or the
       * expectation was — and re-running a verification to find out what it
       * objected to would cost another run.
       */
      canonicalName: place.title,
      canonicalAddress: place.address,
      cid: place.cid,
      note: result.note,
    });
  }

  if (assignments.length > 0) await assignPlaces(assignments);

  const status: "succeeded" | "partial" = missing.length === 0 ? "succeeded" : "partial";

  await recordOutcome(
    askSunnyRunId,
    status,
    {
      locationsReturned: pending.length - missing.length,
      reviewsFetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      invalid: 0,
      unmapped: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 0,
    },
    missing,
    problems.slice(0, 200),
    usageUsd,
    null,
  );

  return {
    status,
    reviewsFetched: 0,
    created: 0,
    updated: 0,
    duplicates: 0,
    countedIntoPeriod: 0,
    storedAsHistorical: 0,
    locationsReturned: pending.length - missing.length,
    missingStoreCodes: missing,
    message: `${verified} location${verified === 1 ? "" : "s"} verified, ${rejected} rejected${
      missing.length > 0 ? `, ${missing.length} not returned by Google` : ""
    }. No review was imported.`,
  };
}

/**
 * The one bounded read that covers a webhook that never arrived.
 *
 * ============================================================================
 * NOT A POLLING LOOP, AND THE DIFFERENCE IS THE TRIGGER
 * ============================================================================
 *
 * A poll asks repeatedly until an answer changes. This asks ONCE, on the next
 * scheduled tick, and only about a run that has been live longer than any run
 * should be. Webhook delivery is best-effort — the request can be lost, the
 * deployment can be mid-rollout when it arrives — and the cost of not covering
 * that is a lock held for six hours and a status panel nobody can trust.
 *
 * It reads Apify; it never STARTS anything, so it cannot spend a credit.
 */
export async function reconcileStaleRuns(
  staleAfterMinutes = 20,
): Promise<{ checked: number; settled: number }> {
  const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000).toISOString();

  const { data, error } = await getSupabaseAdmin()
    .from("google_review_apify_runs")
    .select("id")
    .eq("status", "running")
    .lt("started_at", cutoff)
    .limit(5);

  if (error) {
    console.error("[reviews/apify] could not look for stale runs", error.code ?? "unknown");
    return { checked: 0, settled: 0 };
  }

  const stale = (data ?? []) as { id: string }[];
  let settled = 0;

  for (const row of stale) {
    try {
      const result = await completeApifyRun(row.id);
      if (result.status !== "ignored") settled += 1;
    } catch (error) {
      /*
       * ONE UNREACHABLE RUN MUST NOT STOP THE TICK. The reaper in
       * `google_review_apify_claim_run` is the backstop that eventually frees
       * the slot regardless.
       */
      console.error(
        "[reviews/apify] could not reconcile a stale run",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  return { checked: stale.length, settled };
}
