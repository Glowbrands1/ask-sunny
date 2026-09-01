import { describe, expect, it } from "vitest";

import { canonicalizeReportFilters, eligibleSalons, resolveWindow } from "./canonical";
import { DEFAULT_FILTERS, parseReportFilters, serializeReportFilters } from "./filters";
import type { ReportFilters } from "./filters";
import type { FilterOptions, MetricDescriptor, SalonPeriodDescriptors } from "./types";
import { reportWindows } from "./windows";

/**
 * DEPENDENT-FILTER CANONICALIZATION.
 *
 * The bug these tests hold shut: a URL is a set of independent values, and the
 * things they name are not independent. A comparison decides which sheet is
 * read, which decides which measures exist; a district decides which salons
 * exist; a period decides all of it. Sanitizing each control on its own is what
 * produced a dashboard whose Window control read `—`, whose figures came from
 * `Current MTD`, and which then honestly reported that it had nothing to show.
 *
 * Every fixture below mirrors the live shape: three districts of four, five and
 * six salons; two sheets of one period; leading zeros on every salon number.
 * The figures are invented; the structure is not.
 */

const VS_2024_SHEET = "CompReport(MTD) vs 2024";
const ROLLING_SHEET = "CompReport(MTD)";
const CURRENT = 2026;

function metric(overrides: Partial<MetricDescriptor>): MetricDescriptor {
  return {
    code: "total_revenue",
    label: "Total Revenue",
    family: "revenue",
    unit: "currency",
    higherIsBetter: true,
    basisYearRequired: true,
    comparisonOfCode: null,
    description: "",
    availableBasisYears: [2019, 2024, 2026],
    factCount: 45,
    salonCount: 15,
    sourceSheet: VS_2024_SHEET,
    ...overrides,
  };
}

/** The eight base measures and their changes, as the vs-2024 sheet reports them. */
const VS_2024_MEASURES = [
  "total_revenue",
  "eft_revenue",
  "otc_revenue",
  "total_tans",
  "unique_tanners",
  "uv_tans",
  "sunless_tans",
  "spa_sessions",
];

const CATALOGUE: MetricDescriptor[] = [
  ...VS_2024_MEASURES.map((code) => metric({ code })),
  ...VS_2024_MEASURES.map((code) =>
    metric({
      code: `${code}_pct_change`,
      unit: "percent",
      comparisonOfCode: code,
      availableBasisYears: [2019, 2024],
    }),
  ),
  // The rolling sheet: two measures, four windows, three sides. Twenty-four
  // codes, no basis years, and no base measure of its own.
  ...[3, 6, 9, 12].flatMap((months) =>
    ["total_revenue", "total_tans"].flatMap((measure) =>
      (["current", "prior", "pct_change"] as const).map((side) =>
        metric({
          code: `${measure}_last_${months}m_${side}`,
          basisYearRequired: false,
          comparisonOfCode: side === "pct_change" ? measure : null,
          availableBasisYears: [],
          factCount: 15,
          sourceSheet: ROLLING_SHEET,
        }),
      ),
    ),
  ),
];

const WINDOWS = reportWindows(CATALOGUE, { currentYear: CURRENT, grainLabel: "MTD" });

/** Districts and their salons, matching the live report's three-way split. */
const DISTRICTS: Record<string, string[]> = {
  "Invented-District, One": ["0313", "0314", "0410", "0495"],
  "Invented-District, Two": ["0307", "0309", "0310", "0311", "0312"],
  "Invented-District, Three": ["0306", "0394", "0462", "0463", "0468", "0476"],
};

const SALONS: SalonPeriodDescriptors[] = Object.entries(DISTRICTS).flatMap(
  ([district, numbers]) =>
    numbers.map((salonNumber) => ({
      salonNumber,
      storeName: `Invented Store ${salonNumber}`,
      districtLabel: district,
      regionLabel: "Invented Region North",
      company: "Invented Company",
      ownershipGroup: district === "Invented-District, One" ? "Invented Group A" : "Invented Group B",
      dma: "Invented DMA",
      pricingPlan: null,
      isCompSalon: true,
      quintileGroup: "Top 20%",
      revenueRank: 1,
      salonAgeYears: 10,
      avgClientAge: 30,
      spaPieces: 2,
    })),
);

const FACET_OPTIONS: FilterOptions = {
  district: Object.entries(DISTRICTS).map(([value, numbers]) => ({
    value,
    salonCount: numbers.length,
  })),
  region: [{ value: "Invented Region North", salonCount: 15 }],
  ownership_group: [
    { value: "Invented Group A", salonCount: 4 },
    { value: "Invented Group B", salonCount: 11 },
  ],
};

const PERIOD_ENDS = ["2026-08-30"];

/** Filters straight from a URL, so the tests exercise the real parser too. */
function fromUrl(search: string): ReportFilters {
  return parseReportFilters(new URLSearchParams(search)).filters;
}

const ROLLING_MEASURES = ["total_revenue", "total_tans"];

function canonical(
  filters: ReportFilters,
  overrides: {
    selectableMetricCodes?: string[];
    salons?: SalonPeriodDescriptors[];
    periodEnds?: string[];
    availableGrains?: string[];
    facetOptions?: FilterOptions;
  } = {},
) {
  // The page resolves the window first, then the sheet, then the measures that
  // sheet offers. Mirrored here so the tests exercise the same dependency order
  // rather than a convenient one.
  const window = resolveWindow(WINDOWS, filters.window, 2024);
  const sheet = window?.sourceSheet ?? VS_2024_SHEET;
  const selectable =
    overrides.selectableMetricCodes ??
    (sheet === ROLLING_SHEET ? ROLLING_MEASURES : [...VS_2024_MEASURES].sort());

  return canonicalizeReportFilters(
    {
      filters,
      windows: WINDOWS,
      selectableMetricCodes: selectable,
      facetOptions: overrides.facetOptions ?? FACET_OPTIONS,
      salons: overrides.salons ?? SALONS,
      periodEnds: overrides.periodEnds ?? PERIOD_ENDS,
      availableGrains: overrides.availableGrains ?? [],
    },
    { preferredYear: 2024 },
  );
}

describe("the reported bug: switching into the rolling comparisons", () => {
  it("resolves a rolling view asked for with an incompatible window", () => {
    // The exact URL from the report, in this dashboard's own parameter names.
    // `current` is a real window token and a real comparison — on the OTHER
    // sheet. Paired with the rolling view it is incoherent, and the old code
    // resolved it by falling back per control and landing on Current MTD.
    const result = canonical(fromUrl("view=mtd_rolling&vs=current&grain=weekly"));

    expect(result.window?.id).toBe("current");
    // ...which is why the page translates a retired `view=` first. That step
    // lives in the page because it needs the sheet map; what canonicalization
    // guarantees is the rest: once the window says rolling, everything follows.
    const translated = canonical(fromUrl("vs=last_3m&grain=weekly&metric=eft_revenue"));
    expect(translated.window?.id).toBe("last_3m");
    expect(translated.window?.sourceSheet).toBe(ROLLING_SHEET);
    // EFT Revenue has no rolling column, so it is replaced by Total Revenue
    // rather than left to render an unavailable dashboard nobody asked for.
    expect(translated.filters.metricCodes).toEqual(["total_revenue"]);
    // And Weekly does not survive, because weekly history does not exist.
    expect(translated.filters.grain).toBeNull();
    expect(translated.changed).toBe(true);
  });

  it("keeps Total Revenue when it is already valid for the rolling sheet", () => {
    const result = canonical(fromUrl("vs=last_6m&metric=total_revenue"));
    expect(result.filters.metricCodes).toEqual(["total_revenue"]);
    expect(result.filters.window).toBe("last_6m");
    expect(result.changed).toBe(false);
  });

  it("keeps every one of the four rolling windows selectable", () => {
    for (const token of ["last_3m", "last_6m", "last_9m", "last_12m"]) {
      const result = canonical(fromUrl(`vs=${token}`));
      expect(result.window?.id).toBe(token);
      expect(result.window?.sourceSheet).toBe(ROLLING_SHEET);
      expect(result.filters.metricCodes).toEqual(["total_revenue"]);
    }
  });

  it("offers Total Tans for all four windows", () => {
    for (const token of ["last_3m", "last_6m", "last_9m", "last_12m"]) {
      const result = canonical(fromUrl(`vs=${token}&metric=total_tans`));
      expect(result.filters.metricCodes).toEqual(["total_tans"]);
      expect(result.changed).toBe(false);
    }
  });

  it("returns a valid vs-2024 default when switching back", () => {
    // A measure only the rolling sheet offers is fine on the year sheet too
    // (Total Revenue is on both), so the test uses the window itself: an
    // unrecognised token must land on 2024, never on 2019 and never on nothing.
    const result = canonical(fromUrl("vs=last_18m"));
    expect(result.window?.id).toBe("2024");
    expect(result.window?.sourceSheet).toBe(VS_2024_SHEET);
  });

  it("never defaults to the caveated 2019 baseline", () => {
    const result = canonical(fromUrl("vs=nonsense_token"));
    expect(result.window?.id).not.toBe("2019");
  });

  it("honours 2019 when a manager asks for it explicitly", () => {
    const result = canonical(fromUrl("vs=2019"));
    expect(result.window?.id).toBe("2019");
    expect(result.changed).toBe(false);
  });

  it("drops the retired sheet selector from the canonical URL", () => {
    const result = canonical(fromUrl("view=mtd_vs_2024&vs=2024"));
    expect(result.filters.view).toBeNull();
    expect(serializeReportFilters(result.filters).has("view")).toBe(false);
  });
});

describe("the District to Salon cascade", () => {
  it("offers every salon when no district is selected", () => {
    expect(eligibleSalons(SALONS, DEFAULT_FILTERS)).toHaveLength(15);
  });

  it("offers only one district's salons when one is selected", () => {
    const filters = fromUrl("district=Invented-District%2C+One");
    const eligible = eligibleSalons(SALONS, filters);
    expect(eligible.map((salon) => salon.salonNumber)).toEqual([
      "0313",
      "0314",
      "0410",
      "0495",
    ]);
  });

  it("offers the union when two districts are selected", () => {
    const filters = fromUrl("district=Invented-District%2C+One&district=Invented-District%2C+Two");
    const eligible = eligibleSalons(SALONS, filters);
    expect(eligible).toHaveLength(9);
    expect(eligible.map((salon) => salon.salonNumber).sort()).toEqual([
      "0307",
      "0309",
      "0310",
      "0311",
      "0312",
      "0313",
      "0314",
      "0410",
      "0495",
    ]);
    // A union, not an intersection: two districts are two things a manager
    // wants to see, not an impossible salon belonging to both.
    expect(eligible.some((salon) => salon.districtLabel === "Invented-District, Three")).toBe(false);
  });

  it("preserves leading zeros throughout", () => {
    const eligible = eligibleSalons(SALONS, fromUrl("district=Invented-District%2C+Three"));
    expect(eligible.map((salon) => salon.salonNumber)).toContain("0468");
    for (const salon of eligible) expect(salon.salonNumber).toMatch(/^0\d{3}$/);
  });

  it("ignores the salon selection itself, so the menu can always be widened", () => {
    // The asymmetry that keeps the control usable: tick one salon and the other
    // fourteen must stay on offer. Narrowing the menu by its own selection
    // traps the view with no way back except Reset.
    const filters = fromUrl("salon=0468");
    expect(eligibleSalons(SALONS, filters)).toHaveLength(15);
  });

  it("narrows by ownership group too, not only district", () => {
    const filters = fromUrl("owner=Invented+Group+A");
    expect(eligibleSalons(SALONS, filters)).toHaveLength(4);
  });

  it("excludes a salon whose descriptor was never reported", () => {
    // Treating a null descriptor as a match would quietly widen the selection —
    // a salon appearing under a district it was never filed in.
    const withGap = [
      ...SALONS,
      { ...SALONS[0], salonNumber: "0999", districtLabel: null },
    ];
    const eligible = eligibleSalons(withGap, fromUrl("district=Invented-District%2C+One"));
    expect(eligible.map((salon) => salon.salonNumber)).not.toContain("0999");
  });

  it("drops a salon selection the district no longer admits", () => {
    // District one selected, with one of district three's salons still ticked.
    // would leave a filter narrowing every number on the page with no control
    // showing it.
    const result = canonical(fromUrl("district=Invented-District%2C+One&salon=0468,0313"));
    expect(result.filters.salonNumbers).toEqual(["0313"]);
    expect(result.changed).toBe(true);
    expect(result.dropped.join(" ")).toContain("1 salon outside the selected districts");
  });

  it("drops every salon when none of them belongs to the selected district", () => {
    const result = canonical(fromUrl("district=Invented-District%2C+One&salon=0468,0476"));
    expect(result.filters.salonNumbers).toEqual([]);
    // The district survives: it is the newer, more explicit choice. Dropping it
    // instead would silently widen the report the manager just narrowed.
    expect(result.filters.districts).toEqual(["Invented-District, One"]);
  });

  it("keeps a salon selection that is still inside the selected districts", () => {
    const result = canonical(
      fromUrl("district=Invented-District%2C+One&district=Invented-District%2C+Two&salon=0313,0307"),
    );
    expect(result.filters.salonNumbers).toEqual(["0313", "0307"]);
    expect(result.changed).toBe(false);
  });

  it("survives a comma inside a district name, which every one of them has", () => {
    // The district column holds manager names written `Last, First`. Joining
    // several into one comma-separated parameter and splitting on the way back
    // split `Surname, Forename` into two values, neither of which matches
    // anything — so choosing a district returned an EMPTY dashboard. The filter
    // looked like it worked, because an empty result is a change.
    const query = serializeReportFilters({
      ...DEFAULT_FILTERS,
      districts: ["Invented-District, One", "Invented-District, Two"],
    }).toString();
    expect(fromUrl(query).districts).toEqual(["Invented-District, One", "Invented-District, Two"]);
    expect(eligibleSalons(SALONS, fromUrl(query))).toHaveLength(9);
  });

  it("drops a district value the period does not hold", () => {
    const result = canonical(fromUrl("district=Someone+Who+Left"));
    expect(result.filters.districts).toEqual([]);
    expect(result.dropped.join(" ")).toContain("district value");
    // ...and the salons are then judged against the whole period again.
    expect(eligibleSalons(SALONS, result.filters)).toHaveLength(15);
  });
});

describe("history", () => {
  it("drops a weekly grain while weekly history does not exist", () => {
    const result = canonical(fromUrl("grain=weekly"));
    expect(result.filters.grain).toBeNull();
    expect(result.dropped.join(" ")).toContain("reporting history grain");
  });

  it("keeps a grain once it is genuinely available", () => {
    const result = canonical(fromUrl("grain=monthly"), { availableGrains: ["monthly"] });
    expect(result.filters.grain).toBe("monthly");
  });

  it("still drops Weekly when monthly is available but weekly is not", () => {
    // The case a boolean `historyAvailable` got wrong. A second ingested period
    // makes monthly available, so "history is available" becomes true — and a
    // stale `grain=weekly` then sailed through and displayed as the active
    // selection, over a source that is not produced weekly at all.
    const result = canonical(fromUrl("grain=weekly"), {
      availableGrains: ["monthly", "yearly"],
    });
    expect(result.filters.grain).toBeNull();
    expect(result.dropped.join(" ")).toContain("history grain");
  });
});

describe("period", () => {
  it("drops a period that is no longer loaded, falling back to the newest", () => {
    const result = canonical(fromUrl("period=2025-01-31"));
    expect(result.filters.periodEnd).toBeNull();
    expect(result.dropped.join(" ")).toContain("reporting period that is no longer loaded");
  });

  it("keeps a period that is loaded", () => {
    const result = canonical(fromUrl("period=2026-08-30"));
    expect(result.filters.periodEnd).toBe("2026-08-30");
    expect(result.changed).toBe(false);
  });
});

describe("canonicalization as a whole", () => {
  it("leaves an already-valid filter set completely alone", () => {
    const filters = fromUrl("vs=2024&metric=total_tans&district=Invented-District%2C+One&salon=0313");
    const result = canonical(filters);
    expect(result.changed).toBe(false);
    expect(result.dropped).toEqual([]);
    expect(result.filters).toEqual(filters);
  });

  it("is idempotent: canonicalizing twice changes nothing the second time", () => {
    const once = canonical(fromUrl("view=mtd_rolling&vs=last_9m&grain=weekly&metric=uv_tans&district=Nobody&salon=0468"));
    expect(once.changed).toBe(true);
    const twice = canonical(once.filters);
    expect(twice.changed).toBe(false);
    expect(twice.dropped).toEqual([]);
  });

  it("does not mutate the filters it was given", () => {
    const filters = fromUrl("district=Invented-District%2C+One&salon=0468&grain=weekly");
    const before = JSON.stringify(filters);
    canonical(filters);
    expect(JSON.stringify(filters)).toBe(before);
  });

  it("produces a URL that round-trips to the same state", () => {
    const result = canonical(fromUrl("vs=last_18m&grain=weekly&metric=spa_sessions"));
    const query = serializeReportFilters(result.filters).toString();
    const again = canonical(fromUrl(query));
    expect(again.filters).toEqual(result.filters);
    expect(again.changed).toBe(false);
  });

  it("reports what it dropped, in words a manager can read", () => {
    const result = canonical(fromUrl("vs=last_18m&grain=weekly&district=Nobody&period=2020-01-01"));
    expect(result.dropped).toHaveLength(4);
    for (const entry of result.dropped) {
      // No parameter names, no metric codes: the notice explains what was asked
      // for, not which query-string key carried it.
      expect(entry).not.toMatch(/[=&]/);
      expect(entry.length).toBeGreaterThan(10);
    }
  });

  it("survives a period with no measures at all without inventing one", () => {
    const result = canonical(fromUrl("metric=total_revenue"), { selectableMetricCodes: [] });
    // Nothing selectable means nothing is chosen for the manager. The page
    // reports that it has nothing to show; it does not fabricate a measure.
    expect(result.filters.metricCodes).toEqual(["total_revenue"]);
  });
});
