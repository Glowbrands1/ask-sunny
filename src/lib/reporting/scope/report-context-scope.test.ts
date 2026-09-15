import { describe, expect, it } from "vitest";

import { loadReportContext } from "../read/report-context";
import { reportingScopeOf } from "./authorized-salons";
import type { ReportingReadRepository } from "../read/reporting-read-repository";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * SALON PERFORMANCE, SIDE BY SIDE — THE REVIEW'S OWN TEST
 * ============================================================================
 *
 * "I pulled Salon Performance side by side with the admin session, and it was
 *  identical line for line. An account assigned to one salon can see all 15
 *  salons' revenue, chain rank, quintile, and every director's name attached."
 *
 * The two sessions are simulated below against one fake repository, and the
 * assertion is that they are NOT identical: the restricted one resolves to one
 * salon, asks the repository for one salon, and never learns the other
 * fourteen's names.
 */

const WORNALL: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0306",
  alsoCoversAreaIds: [],
};

const ROSTER = [
  { salonNumber: "0306", storeName: "MO Kansas City Wornall" },
  /*
   * THE SALON THE LIVE LEAK NAMED. `?salon=0307` is a real, ingested salon that
   * the Wornall account is simply not assigned to — which is the case that
   * matters. A salon absent from the roster is dropped by canonicalisation
   * anyway, so testing with one would prove nothing about the boundary.
   */
  { salonNumber: "0307", storeName: "NE Grand Island" },
  { salonNumber: "0313", storeName: "NE Omaha 132nd and Maple" },
  { salonNumber: "0468", storeName: "KS Lawrence" },
];

/** Records what the context asked for, and answers with a minimal period. */
function fakeRepository() {
  const listSalonsCalls: { periodId: string; salonNumbers: readonly string[] }[] = [];

  const repository = {
    async getScope() {
      return {
        ingestionId: "ing-1",
        periodId: "period-1",
        grain: "mtd",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        periodLabel: "MTD Aug 2026",
        fiscalYear: 2026,
        salonCount: ROSTER.length,
        factCount: 99,
        metricCount: 4,
        ingestedAt: "2026-09-01T11:00:00Z",
        parserKey: "comp_sales",
        parserVersion: 1,
        companyWide: false,
      };
    },
    async getFilterOptions() {
      return {};
    },
    async getMetricCatalogue() {
      return [
        {
          code: "total_revenue_2025",
          label: "Total Revenue",
          family: "revenue",
          unit: "currency" as const,
          higherIsBetter: true,
          basisYearRequired: true,
          comparisonOfCode: null,
          description: "",
          availableBasisYears: [2025, 2026],
          factCount: 10,
          salonCount: 3,
          sourceSheet: "MTD",
        },
        {
          code: "total_revenue",
          label: "Total Revenue",
          family: "revenue",
          unit: "currency" as const,
          higherIsBetter: true,
          basisYearRequired: true,
          comparisonOfCode: null,
          description: "",
          availableBasisYears: [2025, 2026],
          factCount: 10,
          salonCount: 3,
          sourceSheet: "MTD",
        },
      ];
    },
    async listSalons(periodId: string, filters: { salonNumbers: readonly string[] }) {
      listSalonsCalls.push({ periodId, salonNumbers: filters.salonNumbers });
      const wanted = filters.salonNumbers;
      const rows = wanted.length === 0 ? ROSTER : ROSTER.filter((row) => wanted.includes(row.salonNumber));
      return rows.map((row) => ({
        ...row,
        districtLabel: null,
        regionLabel: null,
        company: null,
        ownershipGroup: null,
        dma: null,
        pricingPlan: null,
        isCompSalon: true,
        quintileGroup: null,
        revenueRank: null,
        salonAgeYears: null,
        avgClientAge: null,
        spaPieces: null,
      }));
    },
    async listPeriods() {
      return [
        {
          periodId: "period-1",
          grain: "mtd" as const,
          periodEnd: "2026-08-31",
          periodLabel: "MTD Aug 2026",
          salonCount: ROSTER.length,
          ingestedAt: "2026-09-01T11:00:00Z",
        },
      ];
    },
    async getMetricDefinitions() {
      return [];
    },
  };

  return { repository: repository as unknown as ReportingReadRepository, listSalonsCalls };
}

describe("the restricted session is not identical to the administrator's", () => {
  it("resolves the administrator to every salon in the period", async () => {
    const { repository } = fakeRepository();
    const loaded = await loadReportContext({}, repository, reportingScopeOf(null));
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(loaded.context.allSalons.map((salon) => salon.salonNumber)).toEqual(
      ROSTER.map((row) => row.salonNumber),
    );
  });

  it("resolves the Wornall account to Wornall alone", async () => {
    const { repository } = fakeRepository();
    const loaded = await loadReportContext({}, repository, reportingScopeOf(WORNALL));
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;

    expect(loaded.context.allSalons.map((salon) => salon.salonNumber)).toEqual(["0306"]);
    expect(loaded.context.filters.salonNumbers).toEqual(["0306"]);
  });

  it("never hands another salon's NAME to the restricted session", async () => {
    const { repository } = fakeRepository();
    const loaded = await loadReportContext({}, repository, reportingScopeOf(WORNALL));
    if (loaded.status !== "ready") throw new Error("expected a ready context");

    const names = loaded.context.allSalons.map((salon) => salon.storeName).join(" ");
    expect(names).toContain("Wornall");
    expect(names).not.toContain("Omaha");
    expect(names).not.toContain("Lawrence");
  });

  it("asks the repository for one salon, rather than asking for all and filtering", async () => {
    const { repository, listSalonsCalls } = fakeRepository();
    await loadReportContext({}, repository, reportingScopeOf(WORNALL));
    expect(listSalonsCalls.length).toBeGreaterThan(0);
    for (const call of listSalonsCalls) {
      expect(call.salonNumbers).toEqual(["0306"]);
    }
  });
});

describe("a URL cannot reach past the boundary", () => {
  /*
   * ==========================================================================
   * AN EMPTY SALON FILTER MEANS "ALL SALONS" TO EVERY READER DOWNSTREAM
   * ==========================================================================
   *
   * THE LIVE LEAK, 15 September. The Wornall-scoped session opened
   * `/reports/salon-performance?salon=0307` and was shown ALL FIFTEEN salons —
   * a $684,226.16 chain total and every other salon's movers — while the header
   * still read "MO Kansas City Wornall · 1 salon".
   *
   * `narrowSalonSelection(['0306'], ['0307'])` is the intersection of a request
   * with an allowlist that share no member, so it is `[]`. That is the correct
   * answer to "which of these may you see". It is then handed to a repository
   * whose every query reads `if (filters.salonNumbers.length > 0)` — so an
   * empty list applies NO salon predicate, and the refusal became a request for
   * the whole delivery.
   *
   * The page's own `listSalons(periodId, active)` is where it surfaced, but the
   * fault is not in that call site: any reader handed these filters would widen
   * the same way, and a fix that patched one query would leave the next one to
   * be written exposed.
   *
   * So the invariant is asserted on the CONTEXT, not on a screen: a restricted
   * caller never receives an empty salon filter. Either it names the salons
   * they may see, or there is no context at all.
   */
  it("refuses an unauthorized salon instead of widening to every salon", async () => {
    const { repository, listSalonsCalls } = fakeRepository();
    const loaded = await loadReportContext(
      { salon: "0307" },
      repository,
      reportingScopeOf(WORNALL),
    );

    expect(loaded.status).toBe("out_of_scope");
    // Refused BEFORE the roster read, so the other salons' names never load.
    expect(listSalonsCalls).toEqual([]);
  });

  it("refuses a URL naming only other people's salons", async () => {
    const { repository, listSalonsCalls } = fakeRepository();
    const loaded = await loadReportContext(
      { salon: ["0313", "0468"] },
      repository,
      reportingScopeOf(WORNALL),
    );

    expect(loaded.status).toBe("out_of_scope");
    expect(listSalonsCalls).toEqual([]);
  });

  it("never hands a restricted caller an empty salon filter", async () => {
    /*
     * THE INVARIANT ITSELF, stated once. Empty means "all" to the repository,
     * so for a restricted caller it must be unreachable — whatever the URL says.
     */
    for (const salon of [undefined, "0306", ["0306", "0313"], ["0313"], "0307", ""]) {
      const { repository } = fakeRepository();
      const loaded = await loadReportContext(
        salon === undefined ? {} : { salon },
        repository,
        reportingScopeOf(WORNALL),
      );
      if (loaded.status !== "ready") continue;
      expect(
        loaded.context.filters.salonNumbers,
        `an empty filter reads as "all salons" for salon=${JSON.stringify(salon)}`,
      ).not.toEqual([]);
      for (const number of loaded.context.filters.salonNumbers) {
        expect(number).toBe("0306");
      }
    }
  });

  it("leaves an unrestricted caller unrestricted", async () => {
    /*
     * THE OTHER HALF, and the one a careless fix breaks: an administrator's
     * empty salon filter legitimately means every salon, and naming one salon
     * must still work.
     */
    const { repository } = fakeRepository();
    const all = await loadReportContext({}, repository, reportingScopeOf(null));
    if (all.status !== "ready") throw new Error("expected a ready context");
    expect(all.context.filters.salonNumbers).toEqual([]);
    expect(all.context.allSalons).toHaveLength(ROSTER.length);

    const one = await loadReportContext({ salon: "0307" }, repository, reportingScopeOf(null));
    if (one.status !== "ready") throw new Error("expected a ready context");
    expect(one.context.filters.salonNumbers).toEqual(["0307"]);
  });

  it("keeps only the authorized salon when a URL mixes both", async () => {
    const { repository } = fakeRepository();
    const loaded = await loadReportContext(
      { salon: ["0313", "0306"] },
      repository,
      reportingScopeOf(WORNALL),
    );
    if (loaded.status !== "ready") throw new Error("expected a ready context");
    expect(loaded.context.filters.salonNumbers).toEqual(["0306"]);
  });
});

describe("an account with no assignment is refused, not emptied", () => {
  it("returns out_of_scope rather than a context over nothing", async () => {
    const { repository, listSalonsCalls } = fakeRepository();
    const loaded = await loadReportContext(
      {},
      repository,
      reportingScopeOf({ level: "salon", primaryAreaId: null, alsoCoversAreaIds: [] }),
    );
    expect(loaded.status).toBe("out_of_scope");
    // And nothing was read at all.
    expect(listSalonsCalls).toEqual([]);
  });
});
