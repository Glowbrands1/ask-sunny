import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ACTOR_ID,
  maxItemsForRun,
  normaliseActorId,
  readApifyConfig,
  readBooleanFlag,
} from "./config";

/**
 * ============================================================================
 * THE COST GUARDRAILS
 * ============================================================================
 *
 * A wrong per-location limit costs a multiple. A loop that starts runs costs
 * without bound. Both are read here, and everything below is about the second
 * kind of mistake being impossible to make quietly:
 *
 *   OFF BY DEFAULT, so deploying this branch spends nothing.
 *   REFUSED, NOT CLAMPED, so a mistyped limit is reported rather than silently
 *   turned into something else the operator will believe is in force.
 *   BOUNDED AT BOTH ENDS, so neither a typo nor a paste of the wrong value can
 *   turn one run into a month's budget.
 */

const VARIABLES = [
  "APIFY_TOKEN",
  "APIFY_ACTOR_ID",
  "APIFY_SYNC_ENABLED",
  "APIFY_SCHEDULE_ENABLED",
  "APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION",
  "APIFY_REVIEW_INCREMENTAL_LIMIT_PER_LOCATION",
  "APIFY_MAX_RUNS_PER_DAY",
  "APIFY_INCREMENTAL_OVERLAP_HOURS",
  "APIFY_RUN_TIMEOUT_SECONDS",
  "APIFY_RUN_MEMORY_MBYTES",
  "APIFY_SYNC_SCHEDULE",
];

afterEach(() => {
  for (const name of VARIABLES) delete process.env[name];
});

describe("the master switch", () => {
  it("IS OFF WHEN NOTHING IS SET, so deploying this spends nothing", () => {
    expect(readApifyConfig().enabled).toBe(false);
  });

  it("is on only for values that plainly mean yes", () => {
    for (const value of ["true", "TRUE", "1", "yes", "on"]) {
      process.env.APIFY_SYNC_ENABLED = value;
      expect(readBooleanFlag("APIFY_SYNC_ENABLED"), value).toBe(true);
    }
    for (const value of ["false", "0", "no", "off", "maybe", ""]) {
      process.env.APIFY_SYNC_ENABLED = value;
      expect(readBooleanFlag("APIFY_SYNC_ENABLED"), value).toBe(false);
    }
  });

  it("says so when it is on without a token, which is what a half-finished setup looks like", () => {
    /*
     * The symptom of this state — a schedule that fires and imports nothing —
     * is indistinguishable from a quiet week, which is why it is named.
     */
    process.env.APIFY_SYNC_ENABLED = "true";
    const config = readApifyConfig();
    expect(config.problems.join(" ")).toContain("APIFY_TOKEN");
  });
});

describe("the schedule's own switch", () => {
  it("IS OFF WHEN NOTHING IS SET, so a deploy arms no unattended run", () => {
    expect(readApifyConfig().scheduleEnabled).toBe(false);
  });

  it("is independent of the master switch, which is the whole point", () => {
    /*
     * QA needs the state one switch cannot express: manual discovery and manual
     * sync working, while the twice-daily cron starts nothing. With a single
     * flag, turning the integration on for an afternoon's testing also arms an
     * unattended run at 06:00 the next morning.
     */
    process.env.APIFY_SYNC_ENABLED = "true";
    process.env.APIFY_TOKEN = "fixture-token-not-a-real-one";
    const config = readApifyConfig();

    expect(config.enabled).toBe(true);
    expect(config.scheduleEnabled).toBe(false);
  });

  it("turns on only when explicitly set", () => {
    process.env.APIFY_SYNC_ENABLED = "true";
    process.env.APIFY_TOKEN = "fixture-token-not-a-real-one";
    process.env.APIFY_SCHEDULE_ENABLED = "true";
    expect(readApifyConfig().scheduleEnabled).toBe(true);
  });

  it("says so when the schedule is on and the master switch is off", () => {
    /* A contradiction somebody would otherwise read as "the schedule is live". */
    process.env.APIFY_SCHEDULE_ENABLED = "true";
    const config = readApifyConfig();

    expect(config.scheduleEnabled).toBe(true);
    expect(config.enabled).toBe(false);
    expect(config.problems.join(" ")).toContain("starts nothing");
  });
});

describe("the limits", () => {
  it("defaults to a small recurring window and a bounded backfill", () => {
    const config = readApifyConfig();
    expect(config.incrementalLimitPerLocation).toBe(15);
    expect(config.backfillLimitPerLocation).toBe(100);
    expect(config.maxRunsPerDay).toBe(8);
  });

  it("REFUSES A VALUE OUT OF BOUNDS RATHER THAN CLAMPING IT", () => {
    /*
     * Silently turning 50,000 into 500 would let a mistyped limit look like it
     * was accepted, and the operator would go on believing the run is doing
     * something it is not.
     */
    process.env.APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION = "50000";
    const config = readApifyConfig();

    expect(config.backfillLimitPerLocation).toBe(100);
    expect(config.problems.join(" ")).toContain(
      "APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION",
    );
  });

  it("refuses a limit that is not a whole number, and one below the floor", () => {
    process.env.APIFY_REVIEW_INCREMENTAL_LIMIT_PER_LOCATION = "7.5";
    process.env.APIFY_MAX_RUNS_PER_DAY = "0";
    const config = readApifyConfig();

    expect(config.incrementalLimitPerLocation).toBe(15);
    expect(config.maxRunsPerDay).toBe(8);
    expect(config.problems).toHaveLength(2);
  });

  it("caps a backfill at the ingestion's own batch size", () => {
    /*
     * 500 IS `MAX_REVIEWS_PER_SYNC`. A listing is handed to the ingestion in
     * one batch so its feed positions stay comparable; a per-location limit
     * above the batch limit would split a listing and put the reporting
     * boundary inside the split.
     */
    process.env.APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION = "500";
    expect(readApifyConfig().backfillLimitPerLocation).toBe(500);

    process.env.APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION = "501";
    const config = readApifyConfig();
    expect(config.backfillLimitPerLocation).toBe(100);
    expect(config.problems).toHaveLength(1);
  });

  it("accepts a value inside the bounds without complaint", () => {
    process.env.APIFY_REVIEW_INCREMENTAL_LIMIT_PER_LOCATION = "20";
    process.env.APIFY_MAX_RUNS_PER_DAY = "24";
    const config = readApifyConfig();

    expect(config.incrementalLimitPerLocation).toBe(20);
    expect(config.maxRunsPerDay).toBe(24);
    expect(config.problems).toEqual([]);
  });
});

describe("the ceiling Apify itself enforces", () => {
  it("covers every location's window with an allowance for place records", () => {
    /*
     * `maxItems` is sent as a run parameter, so APIFY stops the run at it —
     * whatever the Actor does with its own input limits. That matters because
     * the per-location limit is a request to third-party code and this is a
     * contract with the platform that bills us.
     */
    expect(maxItemsForRun(15, 15)).toBe(15 * 15 + 15);
    expect(maxItemsForRun(1, 1)).toBe(2);
  });

  it("never returns zero, however small the inputs", () => {
    expect(maxItemsForRun(0, 0)).toBeGreaterThan(0);
  });
});

describe("the Actor id", () => {
  it("defaults to the researched Actor, in Apify's own form", () => {
    expect(readApifyConfig().actorId).toBe(DEFAULT_ACTOR_ID);
    expect(DEFAULT_ACTOR_ID).toContain("~");
  });

  it("accepts the readable `owner/name` spelling and converts it", () => {
    expect(normaliseActorId("compass/google-maps-reviews-scraper")).toBe(
      "compass~google-maps-reviews-scraper",
    );
    process.env.APIFY_ACTOR_ID = "someone/another-reviews-actor";
    expect(readApifyConfig().actorId).toBe("someone~another-reviews-actor");
  });

  it("refuses something that is not an Actor id and says which variable", () => {
    process.env.APIFY_ACTOR_ID = "https://apify.com/compass/google-maps-reviews-scraper";
    const config = readApifyConfig();
    expect(config.actorId).toBe(DEFAULT_ACTOR_ID);
    expect(config.problems.join(" ")).toContain("APIFY_ACTOR_ID");
  });
});
