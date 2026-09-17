import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readApifyConfig } from "./config";
import { readLocationMappings, selectRunnableLocations } from "./locations";
import { apifyWebhookConfigured, apifyWebhookConfigurationProblem } from "./webhook-credential";
import type { ApifyRunSummary, ApifySourceStatusReport } from "./types";

/**
 * ============================================================================
 * WHAT THE INTEGRATION STATUS AREA READS
 * ============================================================================
 *
 * ============================================================================
 * "NO NEW REVIEWS" AND "THIS LOCATION FAILED" ARE DIFFERENT SENTENCES
 * ============================================================================
 *
 * The one way a status panel becomes worse than no panel is by collapsing those
 * two. A salon that had a quiet week and a salon whose Google mapping broke
 * both show zero, and if the panel renders them identically the broken one is
 * discovered when somebody happens to check Google by eye — which, for the
 * process this replaces, was six weeks later.
 *
 * So three separate figures are carried, never derived from one another:
 *
 *   LOCATIONS CONFIGURED   how many of the fifteen have a verified Place ID.
 *                          A setup fact. Changes when somebody maps a salon.
 *   LOCATIONS RETURNED     how many answered the last run AT ALL, including
 *                          the ones that answered "nothing new".
 *   REVIEWS FETCHED        how many records came back.
 *
 * A location missing from the second is on `missingStoreCodes` by name, and the
 * panel says so in those words.
 *
 * ============================================================================
 * AND NOTHING HERE ESTIMATES A COST
 * ============================================================================
 *
 * `usageTotalUsd` is what Apify said the run cost, read back from Apify's own
 * run object. A figure computed by the code that spends the money is the one
 * number nobody should trust, so this module does not compute one.
 */

/** How many runs the panel shows. Enough to see a pattern, not a log viewer. */
const RECENT_RUN_LIMIT = 10;

interface RunRow {
  id: string;
  apify_run_id: string | null;
  apify_actor_id: string | null;
  kind: ApifyRunSummary["kind"];
  status: ApifyRunSummary["status"];
  requested_by: string;
  locations_requested: number;
  locations_returned: number;
  reviews_limit_per_location: number | null;
  reviews_since: string | null;
  reviews_fetched: number;
  reviews_created: number;
  reviews_updated: number;
  reviews_duplicate: number;
  reviews_invalid: number;
  reviews_unmapped: number;
  counted_into_period: number;
  stored_as_historical: number;
  usage_total_usd: number | string | null;
  missing_store_codes: string[] | null;
  problems: unknown;
  started_at: string;
  finished_at: string | null;
}

function toSummary(row: RunRow): ApifyRunSummary {
  /*
   * `numeric` COMES BACK AS A STRING from PostgREST, deliberately — it is how
   * Postgres avoids handing a float where an exact decimal was stored. Parsing
   * it here rather than letting `0.0123` reach the UI as a string is the whole
   * reason this mapping is not a spread.
   */
  const usage =
    typeof row.usage_total_usd === "number"
      ? row.usage_total_usd
      : typeof row.usage_total_usd === "string" && row.usage_total_usd.trim().length > 0
        ? Number(row.usage_total_usd)
        : null;

  return {
    id: row.id,
    apifyRunId: row.apify_run_id,
    apifyActorId: row.apify_actor_id,
    kind: row.kind,
    status: row.status,
    requestedBy: row.requested_by,
    locationsRequested: row.locations_requested,
    locationsReturned: row.locations_returned,
    reviewsLimitPerLocation: row.reviews_limit_per_location,
    reviewsSince: row.reviews_since,
    reviewsFetched: row.reviews_fetched,
    reviewsCreated: row.reviews_created,
    reviewsUpdated: row.reviews_updated,
    reviewsDuplicate: row.reviews_duplicate,
    reviewsInvalid: row.reviews_invalid,
    reviewsUnmapped: row.reviews_unmapped,
    countedIntoPeriod: row.counted_into_period,
    storedAsHistorical: row.stored_as_historical,
    usageTotalUsd: usage !== null && Number.isFinite(usage) ? usage : null,
    missingStoreCodes: row.missing_store_codes ?? [],
    problems: Array.isArray(row.problems)
      ? (row.problems as { code?: unknown; storeCode?: unknown }[])
          .map((problem) => ({
            code: typeof problem.code === "string" ? problem.code : "unknown",
            ...(typeof problem.storeCode === "string" ? { storeCode: problem.storeCode } : {}),
          }))
          /* Bounded: a run can record two hundred and the panel shows a summary. */
          .slice(0, 40)
      : [],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

const RUN_COLUMNS =
  "id,apify_run_id,apify_actor_id,kind,status,requested_by,locations_requested," +
  "locations_returned,reviews_limit_per_location,reviews_since,reviews_fetched," +
  "reviews_created,reviews_updated,reviews_duplicate,reviews_invalid,reviews_unmapped," +
  "counted_into_period,stored_as_historical,usage_total_usd,missing_store_codes," +
  "problems,started_at,finished_at";

export async function readApifySourceStatus(): Promise<ApifySourceStatusReport> {
  const config = readApifyConfig();
  const admin = getSupabaseAdmin();

  const mappings = await readLocationMappings();
  const { locations } = selectRunnableLocations(mappings);

  const [recent, lastSuccess, dayCount] = await Promise.all([
    admin
      .from("google_review_apify_runs")
      .select(RUN_COLUMNS)
      .order("started_at", { ascending: false })
      .limit(RECENT_RUN_LIMIT),
    admin
      .from("google_review_apify_runs")
      .select(RUN_COLUMNS)
      /*
       * A PARTIAL RUN COUNTS AS A SUCCESSFUL SYNC. It really did import
       * reviews, and "last successful sync: never" beside a dashboard full of
       * freshly-imported reviews would be the panel contradicting the page it
       * sits next to. The partial state is shown on the run itself.
       */
      .in("status", ["succeeded", "partial"])
      .order("finished_at", { ascending: false })
      .limit(1),
    admin
      .from("google_review_apify_runs")
      .select("id", { count: "exact", head: true })
      .gt("started_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);

  if (recent.error) {
    console.error("[reviews/apify] could not read the run ledger", recent.error.code ?? "unknown");
  }

  /*
   * `as unknown as` because the column list is a concatenated string, which
   * PostgREST's typings cannot narrow. The shape is asserted once, here, and
   * `toSummary` is the only thing that reads it.
   */
  const recentRuns = ((recent.data ?? []) as unknown as RunRow[]).map(toSummary);
  const lastSuccessfulRun =
    ((lastSuccess.data ?? []) as unknown as RunRow[]).map(toSummary)[0] ?? null;

  const problems = [...config.problems];
  const webhookProblem = apifyWebhookConfigurationProblem();
  if (config.enabled && webhookProblem) problems.push(webhookProblem);

  /*
   * A LISTING WITH NO VERIFIED MAPPING IS A CONFIGURATION PROBLEM WORTH SAYING
   * ONCE, by count and never by a wall of fifteen lines. The per-listing detail
   * is in `locations` below, where the panel renders it as a table.
   */
  if (config.enabled && locations.length < mappings.length) {
    const outstanding = mappings.length - locations.length;
    problems.push(
      `${outstanding} of ${mappings.length} Google listings have no verified Place ID, so they are skipped by every run.`,
    );
  }

  return {
    enabled: config.enabled,
    problems,
    actorId: config.actorId,
    tokenConfigured: config.token !== null,
    webhookConfigured: apifyWebhookConfigured(),
    scheduleDescription: config.scheduleDescription,
    backfillLimitPerLocation: config.backfillLimitPerLocation,
    incrementalLimitPerLocation: config.incrementalLimitPerLocation,
    maxRunsPerDay: config.maxRunsPerDay,
    runsStartedInLastDay: dayCount.count ?? 0,
    locationsConfigured: locations.length,
    locationsTotal: mappings.length,
    locations: mappings,
    lastRun: recentRuns[0] ?? null,
    lastSuccessfulRun,
    recentRuns,
    liveRun: recentRuns.find((run) => run.status === "running") ?? null,
  };
}

/** Per listing: what each transport discovered, and what looks like a clash. */
export interface SourceReconciliationRow {
  storeCode: string;
  reviewsTotal: number;
  discoveredByApify: number;
  discoveredByBrave: number;
  /** Reviews both transports have seen. The evidence that the ids agree. */
  seenByBothSources: number;
  withPublicationTime: number;
  /** Pairs that look like one review stored twice. The evidence they do not. */
  suspectedDuplicates: number;
}

/**
 * The Brave-versus-Apify comparison, read from the database's own view.
 *
 * THE CUTOVER QUESTION, ANSWERED WITH NUMBERS RATHER THAN WITH CONFIDENCE. If
 * `seenByBothSources` is positive the two transports are reporting the same
 * Google review ids and the deduplication key holds. If `suspectedDuplicates`
 * is positive they are not, and nothing should be switched over until somebody
 * has looked at why.
 */
export async function readSourceReconciliation(): Promise<SourceReconciliationRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("google_review_source_reconciliation")
    .select("*")
    .order("store_code", { ascending: true });

  if (error) {
    console.error(
      "[reviews/apify] could not read the source reconciliation",
      error.code ?? "unknown",
    );
    return [];
  }

  return (
    (data ?? []) as {
      store_code: string;
      reviews_total: number;
      discovered_by_apify: number;
      discovered_by_brave: number;
      seen_by_both_sources: number;
      with_publication_time: number;
      suspected_duplicates: number;
    }[]
  ).map((row) => ({
    storeCode: row.store_code,
    reviewsTotal: row.reviews_total ?? 0,
    discoveredByApify: row.discovered_by_apify ?? 0,
    discoveredByBrave: row.discovered_by_brave ?? 0,
    seenByBothSources: row.seen_by_both_sources ?? 0,
    withPublicationTime: row.with_publication_time ?? 0,
    suspectedDuplicates: row.suspected_duplicates ?? 0,
  }));
}
