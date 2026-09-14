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
    expect(loaded.context.allSalons.map((salon) => salon.salonNumber)).toEqual([
      "0306",
      "0313",
      "0468",
    ]);
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
  it("drops a salon the account may not see, and does not widen to all", async () => {
    const { repository } = fakeRepository();
    const loaded = await loadReportContext(
      { salon: ["0313", "0468"] },
      repository,
      reportingScopeOf(WORNALL),
    );
    /*
     * ASKING FOR SOMEBODY ELSE'S SALONS YIELDS NOTHING TO SHOW, not everything.
     * The narrowing runs before canonicalisation, so an empty intersection
     * cannot fall through to "no filter means all salons".
     */
    if (loaded.status !== "ready") {
      expect(loaded.status).toBe("out_of_scope");
      return;
    }
    expect(loaded.context.allSalons.map((salon) => salon.salonNumber)).toEqual(["0306"]);
    expect(loaded.context.filters.salonNumbers).not.toContain("0313");
    expect(loaded.context.filters.salonNumbers).not.toContain("0468");
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
