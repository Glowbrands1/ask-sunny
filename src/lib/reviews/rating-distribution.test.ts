import { beforeEach, describe, expect, it, vi } from "vitest";

import { ratingDistribution } from "./aggregate";
import { EMPTY_REVIEW_FILTERS } from "./filters";

/**
 * ============================================================================
 * "REVIEWS BY RATING" COUNTS THE REVIEWS, NOT THE WEEKS THEY QUALIFIED FOR
 * ============================================================================
 *
 * THE DEFECT THIS SUITE EXISTS TO PREVENT, as it shipped. The card was summed
 * from `google_review_location_periods` — the rollup every weekly figure reads,
 * which holds a review only where it was proven to sit above its listing's
 * baseline. On an estate whose baselines have not been set that rollup is
 * empty, so the card drew
 *
 *     5★ 0   4★ 0   3★ 0   2★ 0   1★ 0
 *
 * directly beneath an over-time chart plotting hundreds of the very reviews it
 * was claiming not to have. Neither half was lying; they were answering
 * different questions from one set of rows.
 *
 * So the tests below are about WHERE THE FIGURES COME FROM as much as about
 * what they add up to. A test that only checked the returned numbers would pass
 * against an implementation that reads the period rollup again — which is the
 * bug — so this suite records the QUERY the read layer builds and asserts that
 * no baseline, anchor, period or weekly-eligibility predicate is in it.
 */

interface RecordedQuery {
  table: string;
  head: boolean;
  filters: { op: string; column: string; value: unknown }[];
}

const queries: RecordedQuery[] = [];

/** How many reviews each star is answered with, 1★ first. */
let countByStar: number[] = [0, 0, 0, 0, 0];

/** A builder that records what was asked for and answers with a count. */
function builder(table: string) {
  const record: RecordedQuery = { table, head: false, filters: [] };
  queries.push(record);

  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = (_columns: string, options?: { head?: boolean }) => {
    record.head = options?.head === true;
    return chain;
  };
  chain.order = self;
  chain.limit = self;
  chain.is = self;
  chain.not = self;
  chain.or = (value: unknown) => {
    record.filters.push({ op: "or", column: "", value });
    return chain;
  };
  chain.in = (column: string, value: unknown) => {
    record.filters.push({ op: "in", column, value });
    return chain;
  };
  chain.gte = (column: string, value: unknown) => {
    record.filters.push({ op: "gte", column, value });
    return chain;
  };
  chain.lte = (column: string, value: unknown) => {
    record.filters.push({ op: "lte", column, value });
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    record.filters.push({ op: "eq", column, value });
    return chain;
  };
  /* PostgREST answers a HEAD request with the count and an empty body. */
  chain.then = (resolve: (result: { data: null; count: number; error: null }) => unknown) => {
    const rating = record.filters.find((filter) => filter.column === "rating");
    const index = Number(rating?.value ?? 0) - 1;
    return resolve({ data: null, count: countByStar[index] ?? 0, error: null });
  };

  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => builder(table) }),
}));

const { loadRatingDistribution } = await import("./queries");

beforeEach(() => {
  queries.length = 0;
  countByStar = [0, 0, 0, 0, 0];
});

function ratingFilters() {
  return queries.flatMap((query) => query.filters).filter((filter) => filter.column !== "rating");
}

/* ------------------------------------------------------------ the totals -- */

describe("the star distribution over a fixture of nine reviews", () => {
  /* Three 5-star, two 4-star, one 3-star, two 2-star and one 1-star. */
  const FIXTURE = [1, 2, 1, 2, 3];

  it("counts each star exactly once", () => {
    const distribution = ratingDistribution(FIXTURE);

    expect(distribution.counts[4]).toBe(3); // 5★
    expect(distribution.counts[3]).toBe(2); // 4★
    expect(distribution.counts[2]).toBe(1); // 3★
    expect(distribution.counts[1]).toBe(2); // 2★
    expect(distribution.counts[0]).toBe(1); // 1★
  });

  it("reports a total that is the sum of the five buckets", () => {
    const distribution = ratingDistribution(FIXTURE);

    expect(distribution.total).toBe(9);
    expect(distribution.counts.reduce((running, count) => running + count, 0)).toBe(
      distribution.total,
    );
  });

  it("cannot be handed a total that disagrees with its buckets", () => {
    /*
     * THE INVARIANT IS STRUCTURAL, not a thing to check by eye: the total is
     * derived here and is not an argument, so no caller can supply one.
     */
    expect(ratingDistribution([0, 0, 0, 0, 0]).total).toBe(0);
    expect(ratingDistribution([]).counts).toEqual([0, 0, 0, 0, 0]);
  });

  it("reads the same nine reviews back through the read layer", async () => {
    countByStar = FIXTURE;

    const distribution = await loadRatingDistribution(EMPTY_REVIEW_FILTERS);

    expect(distribution.counts).toEqual([1, 2, 1, 2, 3]);
    expect(distribution.total).toBe(9);
  });
});

/* ------------------------------------------------------- where it reads --- */

describe("the distribution reads the review records", () => {
  it("counts the synced reviews, never the reporting-period rollup", async () => {
    await loadRatingDistribution(EMPTY_REVIEW_FILTERS);

    /* The same relation the over-time chart and the feed read. */
    expect(new Set(queries.map((query) => query.table))).toEqual(
      new Set(["google_reviews_enriched"]),
    );
    expect(queries.map((query) => query.table)).not.toContain(
      "google_review_location_periods",
    );
  });

  it("asks for one bucket per star, and for counts rather than rows", async () => {
    await loadRatingDistribution(EMPTY_REVIEW_FILTERS);

    expect(queries).toHaveLength(5);
    expect(queries.every((query) => query.head)).toBe(true);
    expect(
      queries
        .flatMap((query) => query.filters)
        .filter((filter) => filter.column === "rating")
        .map((filter) => filter.value)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("lets no baseline, anchor, period or weekly rule decide membership", async () => {
    /*
     * THE WHOLE OF THE CORRECTION, as a predicate assertion. Every one of these
     * columns is a fact about REPORTING; none of them is a fact about what a
     * customer gave, and any of them appearing here would reintroduce the zeroes.
     */
    await loadRatingDistribution(EMPTY_REVIEW_FILTERS);

    const columns = ratingFilters().map((filter) => filter.column);
    for (const forbidden of [
      "eligible_for_weekly_count",
      "reporting_period_id",
      "reporting_assignment_status",
      "period_start",
      "period_end",
      "first_seen_at",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------- the filtering ---- */

describe("the distribution narrows by location", () => {
  it("counts only that salon's reviews when one is chosen", async () => {
    await loadRatingDistribution({ ...EMPTY_REVIEW_FILTERS, storeCode: "140" });

    expect(ratingFilters()).toContainEqual({ op: "eq", column: "store_code", value: "140" });
    /* Once per bucket, so no bucket is counted across the whole estate. */
    expect(
      ratingFilters().filter((filter) => filter.column === "store_code"),
    ).toHaveLength(5);
  });

  it("counts every synced review under All Locations", async () => {
    await loadRatingDistribution(EMPTY_REVIEW_FILTERS);

    expect(ratingFilters().map((filter) => filter.column)).not.toContain("store_code");
    expect(ratingFilters().map((filter) => filter.column)).not.toContain("district");
  });

  it("narrows to a district when one is chosen", async () => {
    await loadRatingDistribution({ ...EMPTY_REVIEW_FILTERS, district: "District 5" });

    expect(ratingFilters()).toContainEqual({
      op: "eq",
      column: "district",
      value: "District 5",
    });
  });

  it("ignores the rating filter, which would collapse it to one bar", async () => {
    /*
     * The five bars ARE the rating control, and each one links to its own star.
     * Honouring the filter here would have the card answer its own question by
     * deleting the other four rows.
     */
    await loadRatingDistribution({ ...EMPTY_REVIEW_FILTERS, rating: "5" } as never);

    expect(
      queries
        .flatMap((query) => query.filters)
        .filter((filter) => filter.column === "rating")
        .map((filter) => filter.value)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
  });
});
