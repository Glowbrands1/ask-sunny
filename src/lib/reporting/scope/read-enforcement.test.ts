import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE BOUNDARY IS IN THE QUERY, NOT IN A FILTER AFTERWARDS
 * ============================================================================
 *
 * The 14 September review's requirement, verbatim: "The assistant must not
 * receive unauthorized structured report data and then be told through a prompt
 * not to mention it. Prevent the unauthorized data from being retrieved in the
 * first place."
 *
 * A test that checked the RETURNED rows could pass against an implementation
 * that reads everything and filters in memory — which satisfies the screen and
 * not the requirement, and leaves the rows one logging statement or one
 * serialisation bug away from escaping. So this suite records the QUERY the
 * read layer builds, and asserts that the narrowing predicate is in it.
 */

interface RecordedQuery {
  table: string;
  filters: { op: string; column: string; value: unknown }[];
}

const queries: RecordedQuery[] = [];

/** A builder that records what was asked for and returns no rows. */
function builder(table: string) {
  const record: RecordedQuery = { table, filters: [] };
  queries.push(record);

  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = self;
  chain.order = self;
  chain.limit = self;
  chain.is = (column: string, value: unknown) => {
    record.filters.push({ op: "is", column, value });
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    record.filters.push({ op: "eq", column, value });
    return chain;
  };
  chain.in = (column: string, value: unknown) => {
    record.filters.push({ op: "in", column, value });
    return chain;
  };
  chain.or = (value: unknown) => {
    record.filters.push({ op: "or", column: "", value });
    return chain;
  };
  chain.not = (column: string, op: string, value: unknown) => {
    record.filters.push({ op: `not.${op}`, column, value });
    return chain;
  };
  // Awaiting the builder resolves like PostgREST's own thenable.
  chain.then = (resolve: (result: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null });

  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => builder(table) }),
}));

const { loadBedUsage, loadSpaWellness, loadSpaEngagement, listSpaWellnessPeriods } =
  await import("../read/bed-spa/read");
const { loadSalesTotals } = await import("../read/sales-totals-read");

const WORNALL = ["0306"];

function salonFilters(table: string) {
  return queries
    .filter((query) => query.table === table)
    .flatMap((query) => query.filters)
    .filter((filter) => filter.column === "salon_number");
}

beforeEach(() => {
  queries.length = 0;
});

describe("bed and spa reads narrow in the query", () => {
  it("puts the allowlist on every Bed Usage fact query", async () => {
    await loadBedUsage("period-1", "JB and Associates", WORNALL);

    for (const table of [
      "bed_usage_current_salon_facts",
      "bed_usage_current_equipment_facts",
    ]) {
      expect(salonFilters(table)).toContainEqual({
        op: "in",
        column: "salon_number",
        value: WORNALL,
      });
    }
  });

  it("puts the allowlist on every Spa Wellness fact query", async () => {
    await loadSpaWellness("period-1", "JB and Associates", WORNALL);

    for (const table of [
      "spa_wellness_current_salon_facts",
      "spa_wellness_current_equipment_facts",
    ]) {
      expect(salonFilters(table)).toContainEqual({
        op: "in",
        column: "salon_number",
        value: WORNALL,
      });
    }
  });

  it("puts the allowlist on the Spa Engagement fact query", async () => {
    await loadSpaEngagement("period-1", "JB and Associates", WORNALL);
    expect(salonFilters("spa_engagement_current_salon_facts")).toContainEqual({
      op: "in",
      column: "salon_number",
      value: WORNALL,
    });
  });

  it("narrows the period menu too, so no unopenable period is offered", async () => {
    await listSpaWellnessPeriods("JB and Associates", WORNALL);
    expect(salonFilters("spa_wellness_current_salon_facts")).toContainEqual({
      op: "in",
      column: "salon_number",
      value: WORNALL,
    });
  });

  it("does NOT narrow the chain benchmark, which names nobody", async () => {
    await loadBedUsage("period-1", "JB and Associates", WORNALL);
    expect(salonFilters("bed_usage_chain_benchmarks")).toEqual([]);
  });

  it("adds no predicate at all for an unrestricted reader", async () => {
    await loadSpaEngagement("period-1", "JB and Associates", null);
    expect(salonFilters("spa_engagement_current_salon_facts")).toEqual([]);
  });

  it("still narrows — to nothing — for an account assigned to no salon", async () => {
    await loadSpaEngagement("period-1", "JB and Associates", []);
    /*
     * AN EMPTY LIST IS A PREDICATE, NOT AN ABSENT ONE. The dangerous bug here
     * is "no salons, so no filter", which reads the whole delivery.
     */
    expect(salonFilters("spa_engagement_current_salon_facts")).toContainEqual({
      op: "in",
      column: "salon_number",
      value: [],
    });
  });
});

describe("Sales Totals narrows salons while keeping the chain summary rows", () => {
  it("builds a predicate admitting the summary rows and the allowed salons only", async () => {
    await loadSalesTotals({
      reportDate: "2026-09-12",
      window: "daily",
      authorizedSalonNumbers: WORNALL,
    });

    const clause = queries
      .filter((query) => query.table === "sales_totals_current_facts")
      .flatMap((query) => query.filters)
      .find((filter) => filter.op === "or");

    expect(clause).toBeDefined();
    expect(String(clause!.value)).toContain("scope_kind.eq.summary");
    expect(String(clause!.value)).toContain('salon_number.in.("0306")');
  });

  it("admits the summary rows and NO salon for an account with no assignment", async () => {
    await loadSalesTotals({
      reportDate: "2026-09-12",
      window: "daily",
      authorizedSalonNumbers: [],
    });

    const clause = queries
      .filter((query) => query.table === "sales_totals_current_facts")
      .flatMap((query) => query.filters)
      .find((filter) => filter.op === "or");

    expect(clause).toBeDefined();
    expect(String(clause!.value)).toBe("scope_kind.eq.summary");
    expect(String(clause!.value)).not.toContain("salon_number.in");
  });

  it("adds no predicate for an unrestricted reader", async () => {
    await loadSalesTotals({ reportDate: "2026-09-12", window: "daily" });
    const clause = queries
      .filter((query) => query.table === "sales_totals_current_facts")
      .flatMap((query) => query.filters)
      .find((filter) => filter.op === "or");
    expect(clause).toBeUndefined();
  });

  it("keeps a quotation mark in a salon number from breaking out of the clause", async () => {
    // Salon numbers are validated upstream against SALON_NUMBER_PATTERN, so
    // this cannot arise from a URL. Escaped anyway: a filter predicate built by
    // string concatenation is worth making safe at the point it is built.
    await loadSalesTotals({
      reportDate: "2026-09-12",
      window: "daily",
      authorizedSalonNumbers: ['0306"'],
    });
    const clause = queries
      .filter((query) => query.table === "sales_totals_current_facts")
      .flatMap((query) => query.filters)
      .find((filter) => filter.op === "or");
    expect(String(clause!.value)).toContain('0306\\"');
  });
});
