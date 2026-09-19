import "server-only";

import { SYNC_SCHEDULE_DESCRIPTION } from "./schedule";

/**
 * ============================================================================
 * THE APIFY SOURCE'S CONFIGURATION, AND ITS COST GUARDRAILS
 * ============================================================================
 *
 * ============================================================================
 * THE TOKEN IS SERVER-SIDE, AND `server-only` IS HOW THAT IS ENFORCED
 * ============================================================================
 *
 * `APIFY_TOKEN` can start Actor runs and read every dataset on the account. It
 * is never `NEXT_PUBLIC_`, never sent to the browser, never given to the Brave
 * extension, and never written into a URL. The import above makes a client
 * component that reaches this module a BUILD FAILURE rather than a review
 * comment, which is the only version of that rule worth having.
 *
 * The extension keeps its own narrow `GOOGLE_REVIEW_SYNC_SECRET`, which can do
 * exactly one thing — file reviews for fifteen allowlisted stores — and cannot
 * spend money. Those two credentials are deliberately not the same value and
 * deliberately not revocable together.
 *
 * ============================================================================
 * WHY EVERY LIMIT IS A VARIABLE AND EVERY DEFAULT IS CONSERVATIVE
 * ============================================================================
 *
 * The Actor charges for what it returns. So the two numbers that decide the
 * monthly bill are how many reviews each location returns and how often that
 * happens — and both of them are the kind of number that gets changed during a
 * demo and forgotten. They are read here, bounded here, and bounded again in
 * the database's own run ledger.
 *
 * THE GUARDRAIL THAT MATTERS IS NOT THE LIMIT, IT IS THE RUN COUNT. A wrong
 * per-location limit costs a multiple; a loop that starts runs costs without
 * bound. `APIFY_MAX_RUNS_PER_DAY` is checked inside
 * `google_review_apify_claim_run`, in the same transaction that takes the
 * single-run lock, so no route — including one written later — can start a run
 * without passing it.
 *
 * AND THE SOURCE IS OFF UNTIL SOMEBODY SWITCHES IT ON. `APIFY_SYNC_ENABLED`
 * defaults to false, so deploying this branch spends nothing.
 */

export const APIFY_TOKEN_ENV = "APIFY_TOKEN";
export const APIFY_ACTOR_ENV = "APIFY_ACTOR_ID";
export const APIFY_PLACES_ACTOR_ENV = "APIFY_PLACES_ACTOR_ID";
export const APIFY_ENABLED_ENV = "APIFY_SYNC_ENABLED";
export const APIFY_SCHEDULE_ENABLED_ENV = "APIFY_SCHEDULE_ENABLED";
export const APIFY_BACKFILL_LIMIT_ENV = "APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION";
export const APIFY_INCREMENTAL_LIMIT_ENV = "APIFY_REVIEW_INCREMENTAL_LIMIT_PER_LOCATION";
export const APIFY_MAX_RUNS_ENV = "APIFY_MAX_RUNS_PER_DAY";
export const APIFY_OVERLAP_HOURS_ENV = "APIFY_INCREMENTAL_OVERLAP_HOURS";
export const APIFY_TIMEOUT_ENV = "APIFY_RUN_TIMEOUT_SECONDS";
export const APIFY_MEMORY_ENV = "APIFY_RUN_MEMORY_MBYTES";
export const APIFY_SCHEDULE_ENV = "APIFY_SYNC_SCHEDULE";
export const APIFY_DISCOVERY_CANDIDATES_ENV = "APIFY_DISCOVERY_CANDIDATES_PER_LOCATION";

export { SYNC_SCHEDULE_DESCRIPTION } from "./schedule";

/**
 * THE ACTOR, AS A DEFAULT AND NOT AS AN ASSUMPTION.
 *
 * `compass/google-maps-reviews-scraper` was chosen for the reasons written up
 * in `docs/google-reviews-apify.md` §1: it returns Google's own stable review
 * id and a real publication timestamp, it takes many places in one run, it
 * sorts newest-first and it accepts a date cutoff. It is a default rather than
 * a constant because none of those properties are ours to guarantee — an Actor
 * is somebody else's code on somebody else's schedule — and the normaliser is
 * written to field-alias around the differences a replacement is likely to have.
 *
 * Apify's API accepts `owner~name` in a path where `owner/name` would be
 * ambiguous, so a value written the readable way is converted rather than
 * refused.
 */
export const DEFAULT_ACTOR_ID = "compass~google-maps-reviews-scraper";

/**
 * THE SECOND ACTOR, AND WHY THERE HAS TO BE ONE.
 *
 * The reviews Actor addresses a listing it is GIVEN — `placeIds[]` takes Place
 * IDs, CIDs, FIDs and Maps URLs. It does not search. Finding which Google
 * listing a salon is, from a name and a city, is the places Actors' job, and
 * they take `searchStringsArray`.
 *
 * So discovery uses a places Actor and ingestion uses the reviews Actor, and
 * they are separate variables because they are separate marketplace listings
 * priced on different axes: places are charged per PLACE returned, reviews per
 * REVIEW. Pointing one variable at both would silently change what a run costs.
 *
 * Discovery is a SETUP action. It runs when somebody presses the button, not on
 * a schedule, and once a listing is verified its identifier is persisted and
 * reused forever — `selectRunnableLocations` reads `google_place_id` and no
 * recurring path calls this Actor at all.
 */
export const DEFAULT_PLACES_ACTOR_ID = "compass~google-maps-extractor";

/**
 * THE DEFAULTS, chosen against the cost model in `docs/google-reviews-apify.md`
 * §2 and deliberately on the low side of it.
 *
 * 100 for a backfill: enough to reach back roughly two years at these salons'
 * observed review rate, and a bounded, one-off, manually-triggered cost.
 *
 * 15 for a recurring window: comfortably more than any of the fifteen listings
 * receives between runs, so the anchor stays inside the window and the
 * reporting boundary keeps being provable. Deduplication is by Google's review
 * id, so an overlapping window costs a few fetched records and creates nothing.
 *
 * 8 runs a day: every three hours with a spare, which is far more headroom than
 * the recommended schedule needs and low enough that a runaway trigger is
 * stopped on the same day it starts rather than at the end of the month.
 */
const DEFAULTS = {
  backfillLimit: 100,
  incrementalLimit: 15,
  maxRunsPerDay: 8,
  /**
   * How far back a recurring run's date cutoff reaches BEFORE the last review
   * we hold. A run that asked for "strictly newer than the newest we have"
   * would lose any review posted in the seconds around the previous run and
   * any review whose timestamp Google revises. Six hours of overlap costs a
   * handful of already-known records and closes that window.
   */
  overlapHours: 6,
  timeoutSeconds: 900,
  memoryMbytes: 2048,
  /*
   * How many Google results to consider per salon during discovery.
   *
   * Five is enough to see the franchise locations nearby — which is the POINT:
   * a search that returned only the top hit would hide the second Sun Tan City
   * in the city and turn a genuine ambiguity into a confident wrong answer. It
   * is also the cost knob, since places are charged per place returned.
   */
  discoveryCandidates: 5,
} as const;

/** The bounds. A variable outside them is refused, never silently clamped. */
const BOUNDS = {
  /*
   * 500 IS NOT ARBITRARY: it is `MAX_REVIEWS_PER_SYNC`.
   *
   * A dataset is handed to the existing ingestion one LISTING at a time, so
   * that listing's feed positions stay comparable within a single batch — which
   * is what the anchor model measures against. A per-location limit above the
   * batch limit would mean splitting one listing across two batches, and the
   * boundary between counted and uncounted would fall inside the split.
   */
  backfillLimit: { min: 1, max: 500 },
  incrementalLimit: { min: 1, max: 200 },
  maxRunsPerDay: { min: 1, max: 48 },
  overlapHours: { min: 0, max: 168 },
  timeoutSeconds: { min: 60, max: 3600 },
  memoryMbytes: { min: 256, max: 8192 },
  discoveryCandidates: { min: 1, max: 20 },
} as const;

export interface ApifyConfig {
  /** The master switch. Nothing reaches Apify while this is off. */
  enabled: boolean;
  /**
   * WHETHER THE SCHEDULE MAY START A RUN, separately from whether anything may.
   *
   * Two switches because QA needs exactly the state one switch cannot express:
   * manual discovery and manual sync working, while the twice-daily cron starts
   * nothing. With a single flag, turning the integration on for an afternoon's
   * testing also arms an unattended run at 06:00 the next morning — and the
   * first anybody would know is the usage figure.
   *
   * OFF UNLESS SET, like the master switch. Scheduling is the last thing turned
   * on, after somebody has watched a manual run do the right thing.
   */
  scheduleEnabled: boolean;
  token: string | null;
  actorId: string;
  placesActorId: string;
  discoveryCandidatesPerLocation: number;
  backfillLimitPerLocation: number;
  incrementalLimitPerLocation: number;
  maxRunsPerDay: number;
  overlapHours: number;
  timeoutSeconds: number;
  memoryMbytes: number;
  /**
   * What the status panel says the schedule is.
   *
   * DEFAULTS TO WHAT THE CODE ACTUALLY DOES. The schedule is owned by
   * `schedule.ts` and `vercel.json` together, so the panel describes it from
   * there rather than waiting for somebody to type it into an environment
   * variable — a blank "Next scheduled sync" and a stale one are both worse
   * than the truth. `APIFY_SYNC_SCHEDULE` still overrides it, and is still
   * never parsed: it describes the schedule, it does not set it.
   */
  scheduleDescription: string;
  /** Misconfiguration, by variable name. Never a value. */
  problems: string[];
}

function readBoundedInteger(
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
  problems: string[],
): number {
  const raw = (process.env[name] ?? "").trim();
  if (raw.length === 0) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    problems.push(`${name} must be a whole number. Using ${fallback}.`);
    return fallback;
  }
  if (parsed < bounds.min || parsed > bounds.max) {
    /*
     * REFUSED RATHER THAN CLAMPED. Silently turning 5000 into 1000 would let a
     * mistyped limit look like it was accepted, and the operator would go on
     * believing the run is doing something it is not.
     */
    problems.push(
      `${name} must be between ${bounds.min} and ${bounds.max}. Using ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

/** `true`, `1`, `yes` and `on` are on. Anything else, including absent, is off. */
export function readBooleanFlag(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

/**
 * Apify addresses an Actor as `owner~name`. `owner/name` is the form people
 * read and write, so it is accepted and converted here rather than becoming a
 * 404 somebody has to debug.
 */
export function normaliseActorId(value: string): string {
  return value.trim().replace("/", "~");
}

const ACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_~.-]{2,159}$/;

export function readApifyConfig(): ApifyConfig {
  const problems: string[] = [];

  const token = (process.env[APIFY_TOKEN_ENV] ?? "").trim() || null;

  const actorRaw = (process.env[APIFY_ACTOR_ENV] ?? "").trim();
  let actorId = actorRaw.length > 0 ? normaliseActorId(actorRaw) : DEFAULT_ACTOR_ID;
  if (!ACTOR_ID_PATTERN.test(actorId)) {
    problems.push(
      `${APIFY_ACTOR_ENV} does not look like an Apify Actor id (owner~name). Using ${DEFAULT_ACTOR_ID}.`,
    );
    actorId = DEFAULT_ACTOR_ID;
  }

  const enabled = readBooleanFlag(APIFY_ENABLED_ENV);
  const scheduleEnabled = readBooleanFlag(APIFY_SCHEDULE_ENABLED_ENV);

  /*
   * THE SCHEDULE CANNOT OUTRANK THE MASTER SWITCH. Both must be on for a cron
   * tick to start anything, and this reports the contradiction rather than
   * letting somebody believe the schedule is live when it cannot be.
   */
  if (scheduleEnabled && !enabled) {
    problems.push(
      `${APIFY_SCHEDULE_ENABLED_ENV} is on but ${APIFY_ENABLED_ENV} is off, so the schedule starts nothing.`,
    );
  }

  /*
   * ON WITHOUT A TOKEN IS A MISCONFIGURATION WORTH SAYING OUT LOUD, because it
   * is the state a half-finished setup lands in and the symptom — a schedule
   * that fires and imports nothing — is indistinguishable from a quiet week.
   */
  if (enabled && token === null) {
    problems.push(
      `${APIFY_ENABLED_ENV} is on but ${APIFY_TOKEN_ENV} is not set, so no run can be started.`,
    );
  }

  const placesRaw = (process.env[APIFY_PLACES_ACTOR_ENV] ?? "").trim();
  let placesActorId =
    placesRaw.length > 0 ? normaliseActorId(placesRaw) : DEFAULT_PLACES_ACTOR_ID;
  if (!ACTOR_ID_PATTERN.test(placesActorId)) {
    problems.push(
      `${APIFY_PLACES_ACTOR_ENV} does not look like an Apify Actor id (owner~name). Using ${DEFAULT_PLACES_ACTOR_ID}.`,
    );
    placesActorId = DEFAULT_PLACES_ACTOR_ID;
  }

  const config: ApifyConfig = {
    enabled,
    scheduleEnabled,
    token,
    actorId,
    placesActorId,
    discoveryCandidatesPerLocation: readBoundedInteger(
      APIFY_DISCOVERY_CANDIDATES_ENV,
      DEFAULTS.discoveryCandidates,
      BOUNDS.discoveryCandidates,
      problems,
    ),
    backfillLimitPerLocation: readBoundedInteger(
      APIFY_BACKFILL_LIMIT_ENV,
      DEFAULTS.backfillLimit,
      BOUNDS.backfillLimit,
      problems,
    ),
    incrementalLimitPerLocation: readBoundedInteger(
      APIFY_INCREMENTAL_LIMIT_ENV,
      DEFAULTS.incrementalLimit,
      BOUNDS.incrementalLimit,
      problems,
    ),
    maxRunsPerDay: readBoundedInteger(
      APIFY_MAX_RUNS_ENV,
      DEFAULTS.maxRunsPerDay,
      BOUNDS.maxRunsPerDay,
      problems,
    ),
    overlapHours: readBoundedInteger(
      APIFY_OVERLAP_HOURS_ENV,
      DEFAULTS.overlapHours,
      BOUNDS.overlapHours,
      problems,
    ),
    timeoutSeconds: readBoundedInteger(
      APIFY_TIMEOUT_ENV,
      DEFAULTS.timeoutSeconds,
      BOUNDS.timeoutSeconds,
      problems,
    ),
    memoryMbytes: readBoundedInteger(
      APIFY_MEMORY_ENV,
      DEFAULTS.memoryMbytes,
      BOUNDS.memoryMbytes,
      problems,
    ),
    scheduleDescription:
      (process.env[APIFY_SCHEDULE_ENV] ?? "").trim().slice(0, 120) || SYNC_SCHEDULE_DESCRIPTION,
    problems,
  };

  return config;
}

/**
 * The ceiling on records a single run may return, across all locations.
 *
 * ============================================================================
 * THE LAST GUARDRAIL, AND THE ONLY ONE APIFY ITSELF ENFORCES
 * ============================================================================
 *
 * Everything else here is a number we send. This one is sent as the run's
 * `maxItems`, which Apify applies on ITS side — so an Actor that ignores its
 * own per-place limit, or a mapping that accidentally names the same place
 * fifteen times, still stops. It is the per-location limit times the locations
 * asked for, plus a small allowance for the place-level records some Actors
 * emit alongside the reviews.
 */
export function maxItemsForRun(limitPerLocation: number, locations: number): number {
  const allowance = Math.max(locations, 1);
  return Math.max(limitPerLocation, 1) * Math.max(locations, 1) + allowance;
}
