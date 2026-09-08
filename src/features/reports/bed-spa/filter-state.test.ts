import { describe, expect, it } from "vitest";

import {
  admitsSalon,
  EMPTY_BED_SPA_FILTERS,
  parseBedSpaFilters,
  serializeBedSpaFilters,
} from "./filter-state";
import { summarizeSalons, totalsFor } from "@/lib/reporting/read/bed-spa/bed-usage-analytics";
import type { BedUsageSalonRow } from "@/lib/reporting/read/bed-spa/types";

/**
 * ============================================================================
 * FILTER VALUES THAT CONTAIN THE SEPARATOR
 * ============================================================================
 *
 * The District and Region values in these reports are MANAGER NAMES, written
 * surname-first: `Cotton, Sarah`. Every one of them contains a comma, and the
 * filter state was serialized by joining values with a comma and parsed by
 * splitting on one. So selecting a district produced `district=Cotton%2C+Sarah`,
 * which parsed back as two unrecognised values — `Cotton` and `Sarah` — both of
 * which were dropped, leaving no filter at all and a dashboard that showed
 * every salon however many boxes were ticked.
 *
 * The real labels are used throughout: a fixture called "District A" would have
 * passed against the broken code and proved nothing.
 */

const DISTRICTS = ["Cotton, Sarah", "Dugan, Rachael", "Patterson, Madeline"];
const REGIONS = ["Patterson, Madeline"];
const SALONS = ["0307", "0394", "0468"];
const LEVELS = ["FAST", "FASTER", "FASTEST", "INSTANT", "SPA", "SUNLESS"];
const PERIODS = ["mtd:2026-08-31", "ytd:2026-08-31"];

const available = {
  periods: PERIODS,
  districts: DISTRICTS,
  regions: REGIONS,
  salons: SALONS,
  levels: LEVELS,
  sortFields: ["salon", "tans"],
};

/** What Next hands a page: repeated params arrive as an array. */
function asSearchParams(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length > 1 ? all : all[0]!;
  }
  return out;
}

/** Serialize then parse, the way the client and the server actually pair up. */
function roundTrip(filters: Partial<typeof EMPTY_BED_SPA_FILTERS>) {
  const query = serializeBedSpaFilters({ ...EMPTY_BED_SPA_FILTERS, ...filters });
  return parseBedSpaFilters(asSearchParams(query), available);
}

describe("a district whose name contains a comma survives the round trip", () => {
  for (const district of DISTRICTS) {
    it(`keeps ${district}`, () => {
      const { filters, dropped } = roundTrip({ period: PERIODS[0], districts: [district] });
      expect(filters.districts).toEqual([district]);
      expect(dropped).toEqual([]);
    });
  }

  it("keeps several of them at once", () => {
    const { filters, dropped } = roundTrip({
      period: PERIODS[0],
      districts: ["Cotton, Sarah", "Patterson, Madeline"],
    });
    expect(filters.districts).toEqual(["Cotton, Sarah", "Patterson, Madeline"]);
    expect(dropped).toEqual([]);
  });

  it("keeps a region whose name contains a comma", () => {
    const { filters } = roundTrip({ period: PERIODS[0], regions: ["Patterson, Madeline"] });
    expect(filters.regions).toEqual(["Patterson, Madeline"]);
  });

  it("never emits a value that would parse back as two", () => {
    // The structural assertion: each value is its own parameter, so there is no
    // separator to be ambiguous about.
    const query = serializeBedSpaFilters({
      ...EMPTY_BED_SPA_FILTERS,
      districts: ["Cotton, Sarah", "Dugan, Rachael"],
    });
    expect(query.getAll("district")).toEqual(["Cotton, Sarah", "Dugan, Rachael"]);
  });
});

describe("filters combine", () => {
  it("carries a district alongside every other filter", () => {
    const { filters, dropped } = roundTrip({
      period: PERIODS[1],
      districts: ["Dugan, Rachael"],
      regions: ["Patterson, Madeline"],
      salons: ["0394"],
      levels: ["INSTANT", "SPA"],
      bands: ["outperforming"],
      sort: "tans",
      direction: "desc",
    });
    expect(filters.districts).toEqual(["Dugan, Rachael"]);
    expect(filters.regions).toEqual(["Patterson, Madeline"]);
    expect(filters.salons).toEqual(["0394"]);
    expect(filters.levels).toEqual(["INSTANT", "SPA"]);
    expect(filters.bands).toEqual(["outperforming"]);
    expect(filters.period).toBe(PERIODS[1]);
    expect(filters.sort).toBe("tans");
    expect(filters.direction).toBe("desc");
    expect(dropped).toEqual([]);
  });

  it("treats no district as Select All rather than as a filter", () => {
    // "Everything" is the absence of the parameter, which is what makes the
    // default URL clean and Select All a removal rather than a list of 3.
    const query = serializeBedSpaFilters({ ...EMPTY_BED_SPA_FILTERS, period: PERIODS[0] });
    expect(query.has("district")).toBe(false);
    const { filters } = parseBedSpaFilters(asSearchParams(query), available);
    expect(filters.districts).toEqual([]);
  });
});

describe("what it still refuses, and what it still tolerates", () => {
  it("drops a district this period does not hold, and says so", () => {
    const { filters, dropped } = parseBedSpaFilters(
      { period: PERIODS[0], district: "Invented, Nobody" },
      available,
    );
    expect(filters.districts).toEqual([]);
    expect(dropped.join(" ")).toContain("district");
  });

  it("keeps the recognised half of a mixed selection", () => {
    const { filters, dropped } = parseBedSpaFilters(
      { period: PERIODS[0], district: ["Cotton, Sarah", "Invented, Nobody"] },
      available,
    );
    expect(filters.districts).toEqual(["Cotton, Sarah"]);
    expect(dropped.join(" ")).toContain("1 district");
  });

  it("still reads a legacy comma-joined URL for values without commas", () => {
    /*
     * A bookmark from before this fix. `FAST,INSTANT` is one parameter holding
     * two values, and neither contains a comma, so splitting is still the right
     * reading — and the only way that link keeps working.
     */
    const { filters, dropped } = parseBedSpaFilters(
      { period: PERIODS[0], level: "FAST,INSTANT" },
      available,
    );
    expect(filters.levels).toEqual(["FAST", "INSTANT"]);
    expect(dropped).toEqual([]);
  });

  it("prefers an exact match over splitting", () => {
    // The rule that makes both readings possible at once: a value the period
    // recognises verbatim is one value, comma or not.
    const { filters } = parseBedSpaFilters(
      { period: PERIODS[0], district: "Cotton, Sarah" },
      available,
    );
    expect(filters.districts).toEqual(["Cotton, Sarah"]);
  });

  it("does not duplicate a value presented twice", () => {
    const { filters } = parseBedSpaFilters(
      { period: PERIODS[0], district: ["Cotton, Sarah", "Cotton, Sarah"] },
      available,
    );
    expect(filters.districts).toEqual(["Cotton, Sarah"]);
  });
});

/**
 * ============================================================================
 * SELECTING A DISTRICT MUST CHANGE THE DASHBOARD
 * ============================================================================
 *
 * The parse tests above prove the value survives the URL. These prove the
 * consequence: the salons, and the aggregates computed from them, are actually
 * narrowed — which is what the screen was failing to do.
 *
 * THE FIGURES ARE THE LIVE ONES, read from `bed_usage_current_salon_facts` for
 * mtd 2026-08-31. A fixture with round numbers would pass without proving the
 * arithmetic matches what a manager sees.
 */
const ESTATE: readonly {
  salon: string;
  store: string;
  district: string;
  tans: number;
  beds: number;
}[] = [
  // Cotton, Sarah — 4 salons, 12,925 tans, 86 beds
  { salon: "0313", store: "NE Omaha 132nd and Maple", district: "Cotton, Sarah", tans: 2793, beds: 19 },
  { salon: "0314", store: "NE Omaha 144th and Center", district: "Cotton, Sarah", tans: 1451, beds: 16 },
  { salon: "0410", store: "NE Omaha Pacific", district: "Cotton, Sarah", tans: 2600, beds: 22 },
  { salon: "0495", store: "MO St Joseph", district: "Cotton, Sarah", tans: 6081, beds: 29 },
  // Dugan, Rachael — 5 salons, 12,400 tans, 87 beds
  { salon: "0307", store: "NE Grand Island", district: "Dugan, Rachael", tans: 2644, beds: 20 },
  { salon: "0309", store: "NE Kearney", district: "Dugan, Rachael", tans: 2932, beds: 17 },
  { salon: "0310", store: "NE Lincoln 27th Street", district: "Dugan, Rachael", tans: 2011, beds: 18 },
  { salon: "0311", store: "NE Lincoln O Street", district: "Dugan, Rachael", tans: 2246, beds: 15 },
  { salon: "0312", store: "NE Lincoln Pine Lake", district: "Dugan, Rachael", tans: 2567, beds: 17 },
  // Patterson, Madeline — 6 salons, 23,259 tans, 112 beds
  { salon: "0306", store: "MO Kansas City Wornall", district: "Patterson, Madeline", tans: 3462, beds: 19 },
  { salon: "0394", store: "MO Kansas City Liberty", district: "Patterson, Madeline", tans: 7375, beds: 25 },
  { salon: "0462", store: "KS Manhattan", district: "Patterson, Madeline", tans: 3310, beds: 17 },
  { salon: "0463", store: "KS Shawnee Mission Pkwy", district: "Patterson, Madeline", tans: 3778, beds: 20 },
  { salon: "0468", store: "KS Lawrence", district: "Patterson, Madeline", tans: 1627, beds: 16 },
  { salon: "0476", store: "KS Overland Park", district: "Patterson, Madeline", tans: 3707, beds: 15 },
];

const ALL_DISTRICTS = ["Cotton, Sarah", "Dugan, Rachael", "Patterson, Madeline"];

function estateRows(): BedUsageSalonRow[] {
  return ESTATE.map((entry) => ({
    salonNumber: entry.salon,
    storeName: entry.store,
    districtLabel: entry.district,
    regionLabel: "Patterson, Madeline",
    totalTans: entry.tans,
    bedCount: entry.beds,
  }));
}

/** The page's pipeline: parse the URL, admit salons, summarise, total. */
function dashboard(query: URLSearchParams) {
  const { filters } = parseBedSpaFilters(asSearchParams(query), {
    periods: PERIODS,
    districts: ALL_DISTRICTS,
    regions: ["Patterson, Madeline"],
    salons: ESTATE.map((entry) => entry.salon),
  });
  const admitted = estateRows().filter((salon) => admitsSalon(filters, salon));
  const totals = totalsFor(summarizeSalons(admitted, []));
  return {
    districts: filters.districts,
    salonNumbers: admitted.map((salon) => salon.salonNumber),
    salonCount: totals.salonCount,
    tans: totals.totalTans,
    beds: totals.bedCount,
  };
}

function selecting(districts: string[]) {
  return dashboard(
    serializeBedSpaFilters({ ...EMPTY_BED_SPA_FILTERS, period: PERIODS[0], districts }),
  );
}

describe("the whole estate reconciles before any filter", () => {
  it("holds the live figures the dashboard shows", () => {
    const all = selecting([]);
    expect(all.salonCount).toBe(15);
    expect(all.tans).toBe(48584);
    expect(all.beds).toBe(285);
  });
});

describe("selecting one district narrows the dashboard to that district", () => {
  const expected = [
    { district: "Cotton, Sarah", salons: 4, tans: 12925, beds: 86 },
    { district: "Dugan, Rachael", salons: 5, tans: 12400, beds: 87 },
    { district: "Patterson, Madeline", salons: 6, tans: 23259, beds: 112 },
  ];

  for (const row of expected) {
    it(`${row.district} returns only its ${row.salons} salons`, () => {
      const view = dashboard(
        serializeBedSpaFilters({
          ...EMPTY_BED_SPA_FILTERS,
          period: PERIODS[0],
          districts: [row.district],
        }),
      );

      // The filter arrived intact — the half that was broken.
      expect(view.districts).toEqual([row.district]);

      // Only that district's salons, and the aggregates that follow.
      expect(view.salonCount).toBe(row.salons);
      expect(view.tans).toBe(row.tans);
      expect(view.beds).toBe(row.beds);

      const belong = ESTATE.filter((entry) => entry.district === row.district).map((e) => e.salon);
      expect([...view.salonNumbers].sort()).toEqual([...belong].sort());

      // And it is genuinely narrower than the estate, which is the assertion
      // that fails when a filter silently does nothing.
      expect(view.salonCount).toBeLessThan(15);
      expect(view.tans).toBeLessThan(48584);
    });
  }

  it("gives each district a different total", () => {
    // Three filters that all returned 48,584 was the symptom.
    const totals = expected.map((row) => selecting([row.district]).tans);
    expect(new Set(totals).size).toBe(3);
  });

  it("adds back up to the estate across the three districts", () => {
    const sum = expected.reduce((total, row) => total + row.tans, 0);
    expect(sum).toBe(48584);
    expect(expected.reduce((total, row) => total + row.salons, 0)).toBe(15);
    expect(expected.reduce((total, row) => total + row.beds, 0)).toBe(285);
  });
});

describe("Select All restores the estate", () => {
  it("returns all 15 salons when no district is selected", () => {
    const view = selecting([]);
    expect(view.districts).toEqual([]);
    expect(view.salonCount).toBe(15);
    expect(view.tans).toBe(48584);
    expect(view.beds).toBe(285);
  });

  it("returns all 15 salons when every district is selected explicitly", () => {
    // Ticking all three must equal ticking none. It did not have to: an
    // all-values URL takes the multi-value path, which is the one that broke.
    const view = selecting(ALL_DISTRICTS);
    expect(view.districts).toEqual(ALL_DISTRICTS);
    expect(view.salonCount).toBe(15);
    expect(view.tans).toBe(48584);
    expect(view.beds).toBe(285);
  });
});

describe("district filtering combines with the other filters", () => {
  it("intersects with a salon selection", () => {
    const view = dashboard(
      serializeBedSpaFilters({
        ...EMPTY_BED_SPA_FILTERS,
        period: PERIODS[0],
        districts: ["Patterson, Madeline"],
        salons: ["0394", "0463"],
      }),
    );
    expect(view.salonCount).toBe(2);
    expect(view.tans).toBe(7375 + 3778);
    expect([...view.salonNumbers].sort()).toEqual(["0394", "0463"]);
  });

  it("returns nothing when the district and the salon disagree", () => {
    // An empty result is CORRECT here, and is why an unrecognised value must be
    // dropped rather than applied: the two states must not look alike.
    const view = dashboard(
      serializeBedSpaFilters({
        ...EMPTY_BED_SPA_FILTERS,
        period: PERIODS[0],
        districts: ["Cotton, Sarah"],
        salons: ["0394"],
      }),
    );
    expect(view.salonCount).toBe(0);
    expect(view.tans).toBeNull();
  });

  it("intersects with a region selection", () => {
    const view = dashboard(
      serializeBedSpaFilters({
        ...EMPTY_BED_SPA_FILTERS,
        period: PERIODS[0],
        districts: ["Dugan, Rachael"],
        regions: ["Patterson, Madeline"],
      }),
    );
    expect(view.salonCount).toBe(5);
    expect(view.tans).toBe(12400);
  });

  it("keeps two districts together", () => {
    const view = selecting(["Cotton, Sarah", "Dugan, Rachael"]);
    expect(view.salonCount).toBe(9);
    expect(view.tans).toBe(12925 + 12400);
    expect(view.beds).toBe(86 + 87);
  });
});

describe("a salon with no district", () => {
  it("is excluded by a district filter rather than admitted by default", () => {
    // Unattributed is not the same as belonging to whichever district was
    // picked — a salon the Comp Report has not placed for this period must not
    // be counted into somebody's district.
    const unplaced: BedUsageSalonRow = {
      salonNumber: "0999",
      storeName: "Salon 0999",
      districtLabel: null,
      regionLabel: null,
      totalTans: 100,
      bedCount: 1,
    };
    expect(admitsSalon({ districts: ["Cotton, Sarah"], regions: [], salons: [] }, unplaced)).toBe(
      false,
    );
    // And admitted when nothing is filtered.
    expect(admitsSalon({ districts: [], regions: [], salons: [] }, unplaced)).toBe(true);
  });
});
