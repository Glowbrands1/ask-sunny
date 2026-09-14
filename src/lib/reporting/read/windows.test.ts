import { describe, expect, it } from "vitest";

import type { MetricDescriptor } from "./types";
import {
  basisYearWindow,
  selectableMeasureCodes,
  currentWindow,
  defaultWindow,
  findWindow,
  defaultWindowForSheet,
  isWindowToken,
  preferredBaselineYear,
  reportWindows,
  rollingWindow,
  windowsForSheet,
  windowAvailableFor,
  windowCaveatSentence,
  windowMetricCodeList,
  windowMetricCodes,
} from "./windows";

/**
 * WINDOWS ARE READ OFF THE DATA.
 *
 * These tests exist to hold one line: a comparison appears in the picker because
 * the report contains it, never because somebody listed it. That is what makes
 * "Last 3 Months" honestly absent today and automatically present the day the
 * rolling-window columns are ingested — with no change to the UI.
 *
 * The `LIVE_SHAPED` catalogue mirrors the audited workbook exactly: basis years
 * 2026 / 2024 / 2019 on every measure except spa sessions, which has no 2019
 * block at all. `WITH_ROLLING` is the same catalogue plus the metrics a second
 * sheet would add, so the discovery path is proven before that data exists.
 */

const CURRENT = 2026;

/** The two sheets the live workbook actually produces facts from. */
const VS_2024_SHEET = "CompReport(MTD) vs 2024";
const ROLLING_SHEET = "CompReport(MTD)";

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

const LIVE_SHAPED: MetricDescriptor[] = [
  metric({ code: "total_revenue" }),
  metric({ code: "eft_revenue", label: "EFT Revenue" }),
  metric({
    code: "total_revenue_pct_change",
    label: "Total Revenue % Change",
    unit: "percent",
    comparisonOfCode: "total_revenue",
    availableBasisYears: [2019, 2024],
    factCount: 30,
  }),
  // The real gap: spa sessions has no 2019 figures anywhere in the workbook.
  metric({
    code: "spa_sessions",
    label: "Spa Sessions",
    family: "volume",
    unit: "count",
    availableBasisYears: [2024, 2026],
    factCount: 30,
  }),
  metric({
    code: "spa_sessions_pct_change",
    label: "Spa Sessions % Change",
    family: "volume",
    unit: "percent",
    comparisonOfCode: "spa_sessions",
    availableBasisYears: [2024],
    factCount: 7,
  }),
];

/**
 * Both sheets loaded, which is the live state.
 *
 * The rolling metrics carry the ROLLING sheet's name, because that is where the
 * source keeps them. That detail is the whole reason windows know their sheet:
 * the two sets describe the same period, so nothing but the sheet distinguishes
 * "the comparisons on this tab" from "the comparisons on that one".
 */
const WITH_ROLLING: MetricDescriptor[] = [
  ...LIVE_SHAPED,
  metric({
    code: "total_revenue_last_3m_current",
    label: "Revenue, current year last 3 months",
    basisYearRequired: false,
    availableBasisYears: [],
    factCount: 15,
    sourceSheet: ROLLING_SHEET,
  }),
  metric({
    code: "total_revenue_last_3m_prior",
    label: "Revenue, prior year last 3 months",
    basisYearRequired: false,
    availableBasisYears: [],
    factCount: 15,
    sourceSheet: ROLLING_SHEET,
  }),
  metric({
    code: "total_revenue_last_3m_pct_change",
    label: "Last 3 Months % Change",
    unit: "percent",
    basisYearRequired: false,
    comparisonOfCode: "total_revenue",
    availableBasisYears: [],
    factCount: 15,
    sourceSheet: ROLLING_SHEET,
  }),
];

describe("window discovery", () => {
  it("offers only the comparisons the report holds", () => {
    const windows = reportWindows(LIVE_SHAPED, { currentYear: CURRENT, grainLabel: "MTD" });
    expect(windows.map((window) => window.id)).toEqual(["current", "2024", "2019"]);
  });

  it("offers no rolling window until rolling metrics carry facts", () => {
    // The whole point. The audited workbook's ingested sheet has no Last 3/6/9/12
    // month column, so the picker must not pretend otherwise.
    const windows = reportWindows(LIVE_SHAPED, { currentYear: CURRENT });
    expect(windows.some((window) => window.kind === "rolling")).toBe(false);
  });

  it("picks up a rolling window the moment its metric exists", () => {
    const windows = reportWindows(WITH_ROLLING, { currentYear: CURRENT });
    expect(windows.map((window) => window.id)).toEqual([
      "current",
      "2024",
      "2019",
      "last_3m",
    ]);
    const rolling = windows.find((window) => window.id === "last_3m");
    expect(rolling?.label).toBe("Last 3 Months");
    expect(rolling?.months).toBe(3);
  });

  it("names the current window after the report's own grain", () => {
    expect(reportWindows(LIVE_SHAPED, { currentYear: CURRENT, grainLabel: "YTD" })[0].label).toBe(
      "Current YTD",
    );
  });

  it("orders years newest first and rolling windows shortest first", () => {
    const catalogue = [
      metric({ code: "total_revenue", availableBasisYears: [2019, 2024, 2025, 2026] }),
      metric({ code: "r_last_12m_pct_change", basisYearRequired: false, availableBasisYears: [] }),
      metric({ code: "r_last_3m_pct_change", basisYearRequired: false, availableBasisYears: [] }),
    ];
    expect(
      reportWindows(catalogue, { currentYear: CURRENT }).map((window) => window.id),
    ).toEqual(["current", "2025", "2024", "2019", "last_3m", "last_12m"]);
  });
});

describe("the default window", () => {
  it("is 2024, and never 2019", () => {
    const windows = reportWindows(LIVE_SHAPED, { currentYear: CURRENT });
    expect(defaultWindow(windows, 2024).id).toBe("2024");
  });

  it("falls back to the newest uncaveated year when 2024 is absent", () => {
    const windows = [currentWindow(), basisYearWindow(2025), basisYearWindow(2019)];
    expect(defaultWindow(windows, 2024).id).toBe("2025");
  });

  it("never defaults to a caveated baseline, even as the only comparison", () => {
    // 2019's comparison population is unconfirmed. Opening a dashboard on it
    // would make every unqualified reading of the page wrong.
    const windows = [currentWindow(), basisYearWindow(2019)];
    expect(defaultWindow(windows, 2024).id).toBe("current");
  });
});

describe("window tokens", () => {
  it("accepts the three shapes and nothing else", () => {
    expect(isWindowToken("current")).toBe(true);
    expect(isWindowToken("2024")).toBe(true);
    expect(isWindowToken("last_12m")).toBe(true);
    expect(isWindowToken("last_123m")).toBe(false);
    expect(isWindowToken("2024; drop table")).toBe(false);
    expect(isWindowToken("")).toBe(false);
  });

  it("resolves a token against the report's own windows", () => {
    const windows = reportWindows(LIVE_SHAPED, { currentYear: CURRENT });
    expect(findWindow(windows, "2019")?.basisYear).toBe(2019);
    // A token the report does not hold resolves to nothing, so the caller
    // falls back to a default rather than querying for a window that is absent.
    expect(findWindow(windows, "last_6m")).toBeNull();
    expect(findWindow(windows, null)).toBeNull();
  });
});

describe("metric codes for a window", () => {
  it("reads the current period's own figure and nothing else", () => {
    const codes = windowMetricCodes("total_revenue", currentWindow(), CURRENT);
    expect(codes).toMatchObject({
      currentCode: "total_revenue",
      currentBasisYear: 2026,
      baselineCode: null,
      changeCode: null,
      baselineLabel: null,
    });
  });

  it("reads one metric at two basis years for a year comparison", () => {
    const codes = windowMetricCodes("total_revenue", basisYearWindow(2024), CURRENT);
    expect(codes).toMatchObject({
      currentCode: "total_revenue",
      currentBasisYear: 2026,
      baselineCode: "total_revenue",
      baselineBasisYear: 2024,
      changeCode: "total_revenue_pct_change",
      changeBasisYear: 2024,
    });
  });

  it("reads three separate rolling metrics, none of them year-keyed", () => {
    const codes = windowMetricCodes("total_tans", rollingWindow(12), CURRENT);
    expect(codes).toMatchObject({
      currentCode: "total_tans_last_12m_current",
      baselineCode: "total_tans_last_12m_prior",
      changeCode: "total_tans_last_12m_pct_change",
    });
    // The window IS the period, so a basis year would be meaningless — and the
    // schema stores these with basis_year null for exactly that reason.
    expect(codes.currentBasisYear).toBeNull();
    expect(codes.baselineBasisYear).toBeNull();
    expect(codes.changeBasisYear).toBeNull();
  });

  it("lists every code a page load needs, de-duplicated", () => {
    expect(windowMetricCodeList("total_revenue", basisYearWindow(2024), CURRENT)).toEqual([
      "total_revenue",
      "total_revenue_pct_change",
    ]);
    expect(windowMetricCodeList("total_revenue", currentWindow(), CURRENT)).toEqual([
      "total_revenue",
    ]);
  });
});

describe("availability, and refusing to substitute", () => {
  it("confirms a comparison the report holds", () => {
    expect(
      windowAvailableFor(LIVE_SHAPED, "total_revenue", basisYearWindow(2024), CURRENT),
    ).toBe(true);
    expect(
      windowAvailableFor(LIVE_SHAPED, "total_revenue", basisYearWindow(2019), CURRENT),
    ).toBe(true);
  });

  it("offers spa sessions against 2019 as a figure without a comparison", () => {
    /*
     * THIS EXPECTATION CHANGED, and deliberately.
     *
     * `spa_sessions` has a 2026 figure and no 2019 block — the real gap in the
     * workbook. The product used to drop the measure entirely for that window,
     * which is the same defect the `vs 2025` headline row showed: a figure the
     * source reports perfectly well disappearing because its comparison is
     * missing.
     *
     * It is now offered, and the card and the reading say the 2019 comparison
     * is not reported. The gap is still stated; it is stated about the
     * comparison instead of about the measure.
     */
    const window = basisYearWindow(2019, VS_2024_SHEET);
    expect(windowAvailableFor(LIVE_SHAPED, "spa_sessions", window, CURRENT)).toBe(true);

    const codes = windowMetricCodes("spa_sessions", window, CURRENT);
    expect(codes.currentBasisYear).toBe(CURRENT);
    expect(codes.baselineBasisYear).toBe(2019);
  });

  it("refuses a rolling window for a measure the source does not report", () => {
    // The workbook carries Last 3/6/9/12 months for Revenue and Total Tans
    // ONLY. EFT Revenue has no such column and never will unless the source
    // adds one, so this pair must read Unavailable rather than borrow a figure.
    expect(windowAvailableFor(WITH_ROLLING, "eft_revenue", rollingWindow(3), CURRENT)).toBe(
      false,
    );
    expect(windowAvailableFor(WITH_ROLLING, "total_revenue", rollingWindow(3), CURRENT)).toBe(
      true,
    );
  });

  it("judges a year comparison against the sheet that reports it", () => {
    // The rolling sheet holds no 2024 figures. Asked about `vs 2024` while
    // scoped to it, the answer is no — and the dashboard's control must not
    // offer it there.
    expect(
      windowAvailableFor(ROLLING_ONLY, "total_revenue", basisYearWindow(2024), CURRENT),
    ).toBe(false);
  });

  it("refuses a measure that is not in the catalogue at all", () => {
    expect(windowAvailableFor(LIVE_SHAPED, "invented_measure", currentWindow(), CURRENT)).toBe(
      false,
    );
  });
});

describe("the 2019 caveat", () => {
  it("travels with the window wherever it is shown", () => {
    const window = basisYearWindow(2019);
    expect(window.label).toBe("2019 baseline — comparison population unconfirmed");
    expect(windowCaveatSentence(window)).toContain("comparison population unconfirmed");
  });

  it("is absent for a comparison that carries no caveat", () => {
    expect(windowCaveatSentence(basisYearWindow(2024))).toBeNull();
    expect(windowCaveatSentence(rollingWindow(6))).toBeNull();
  });
});

/**
 * The catalogue a ROLLING sheet produces: trailing-window codes only, no base
 * measure of its own, and no basis years at all. This is exactly what
 * `comp_sales_metric_catalogue` returns for `CompReport(MTD)` once its facts are
 * ingested, so these tests describe the post-ingestion dashboard.
 */
const ROLLING_ONLY: MetricDescriptor[] = [3, 6, 9, 12].flatMap((months) =>
  ["total_revenue", "total_tans"].flatMap((measure) =>
    (["current", "prior", "pct_change"] as const).map((side) =>
      metric({
        code: `${measure}_last_${months}m_${side}`,
        label: `${measure} ${side} ${months}m`,
        family: measure === "total_revenue" ? "revenue" : "volume",
        unit: side === "pct_change" ? "percent" : "currency",
        basisYearRequired: false,
        comparisonOfCode: side === "pct_change" ? measure : null,
        // A trailing window has no basis year. The catalogue view returns `{}`.
        availableBasisYears: [],
        factCount: 15,
        sourceSheet: ROLLING_SHEET,
      }),
    ),
  ),
);

describe("the rolling view, once its facts exist", () => {
  it("offers only the four rolling windows — no year comparison, and no Current", () => {
    const windows = reportWindows(ROLLING_ONLY, { currentYear: CURRENT, grainLabel: "MTD" });
    expect(windows.map((window) => window.id)).toEqual([
      "last_3m",
      "last_6m",
      "last_9m",
      "last_12m",
    ]);
    // No `vs 2024`: those facts belong to the other sheet.
    expect(windows.some((window) => window.kind === "basis_year")).toBe(false);
    // AND NO `Current MTD`, which is the reported bug. Every column of this
    // sheet is a comparison; it holds no uncompared current figure at all. The
    // window used to be prepended unconditionally, so the dashboard offered it,
    // defaulted to it, and then correctly reported that it had nothing to show.
    expect(windows.some((window) => window.kind === "current")).toBe(false);
  });

  it("offers Total Revenue and Total Tans as the measures, not the 24 codes", () => {
    // A manager picks the measure; the window decides which of its three sides
    // and four windows is read. Offering the raw codes would put twelve
    // near-identical entries in the picker.
    expect(selectableMeasureCodes(ROLLING_ONLY)).toEqual(["total_revenue", "total_tans"]);
  });

  it("resolves a measure and window pair to the source's own columns", () => {
    const window = rollingWindow(12);
    expect(windowAvailableFor(ROLLING_ONLY, "total_tans", window, CURRENT)).toBe(true);
    expect(windowMetricCodes("total_tans", window, CURRENT)).toMatchObject({
      currentCode: "total_tans_last_12m_current",
      baselineCode: "total_tans_last_12m_prior",
      changeCode: "total_tans_last_12m_pct_change",
    });
  });

  it("refuses every measure the rolling sheet does not carry", () => {
    // The workbook has rolling columns for Revenue and Total Tans ONLY.
    for (const code of [
      "eft_revenue",
      "otc_revenue",
      "unique_tanners",
      "spa_sessions",
      "uv_tans",
      "sunless_tans",
    ]) {
      expect(windowAvailableFor(ROLLING_ONLY, code, rollingWindow(3), CURRENT)).toBe(false);
      expect(selectableMeasureCodes(ROLLING_ONLY)).not.toContain(code);
    }
  });

  it("opens on the shortest rolling window when no year comparison exists", () => {
    // 2024 is the preferred default and is absent here, so the fallback must be
    // an option that can actually show something. It used to fall through to
    // `windows[0]`, which was `Current MTD` — a comparison this sheet does not
    // carry — so the dashboard opened on a guaranteed "Unavailable".
    const windows = reportWindows(ROLLING_ONLY, { currentYear: CURRENT });
    expect(defaultWindow(windows, 2024).id).toBe("last_3m");
  });

  it("carries the sheet on every window it discovers", () => {
    for (const window of reportWindows(ROLLING_ONLY, { currentYear: CURRENT })) {
      expect(window.sourceSheet).toBe(ROLLING_SHEET);
    }
  });
});

describe("windows across both sheets", () => {
  it("offers every comparison the period holds, each naming its own sheet", () => {
    const windows = reportWindows(WITH_ROLLING, { currentYear: CURRENT, grainLabel: "MTD" });
    expect(
      windows.map((window) => [window.id, window.sourceSheet]),
    ).toEqual([
      ["current", VS_2024_SHEET],
      ["2024", VS_2024_SHEET],
      ["2019", VS_2024_SHEET],
      ["last_3m", ROLLING_SHEET],
    ]);
  });

  it("lets a window select its sheet, which is what retires the View control", () => {
    const windows = reportWindows(WITH_ROLLING, { currentYear: CURRENT });
    expect(findWindow(windows, "last_3m")?.sourceSheet).toBe(ROLLING_SHEET);
    expect(findWindow(windows, "2024")?.sourceSheet).toBe(VS_2024_SHEET);
  });

  it("gives each sheet its own default: the prior year on one, Last 3 Months on the other", () => {
    const windows = reportWindows(WITH_ROLLING, { currentYear: CURRENT });
    /*
     * THE PREFERRED YEAR IS DERIVED AND PASSED IN, not defaulted here. The 14
     * September review found the dashboard opening on "vs. 2024" in 2026
     * because the parameter defaulted to the literal 2024; it is now required,
     * so a caller that forgets gets a compile error rather than a stale year.
     */
    const preferred = preferredBaselineYear(CURRENT);
    expect(preferred).toBe(CURRENT - 1);
    /*
     * THIS FIXTURE CARRIES NO 2025 BLOCK, so the preference cannot be honoured
     * and the documented fallback applies: the newest uncaveated year, which is
     * 2024. That is the right answer for this data — and the point is that it
     * is REACHED rather than assumed, so the same code opens on 2025 the moment
     * a delivery carries it.
     */
    expect(defaultWindowForSheet(windows, VS_2024_SHEET, preferred)?.id).toBe("2024");
    expect(defaultWindowForSheet(windows, ROLLING_SHEET, preferred)?.id).toBe("last_3m");
    // A sheet with nothing loaded has no default, rather than borrowing one.
    expect(defaultWindowForSheet(windows, "CompReport(YTD)", preferred)).toBeNull();
  });

  it("opens on the prior year as soon as the delivery carries it", () => {
    /*
     * The 14 September review: "The comparison is set to vs. 2024, not 2025."
     * The same catalogue with a 2025 block must open on 2025, with no code
     * change and no constant edited.
     */
    const withPriorYear = WITH_ROLLING.map((entry) =>
      entry.sourceSheet === VS_2024_SHEET
        ? { ...entry, availableBasisYears: [...entry.availableBasisYears, 2025].sort() }
        : entry,
    );
    const windows = reportWindows(withPriorYear, { currentYear: CURRENT });
    const preferred = preferredBaselineYear(CURRENT);

    expect(defaultWindowForSheet(windows, VS_2024_SHEET, preferred)?.id).toBe("2025");
    expect(defaultWindow(windowsForSheet(windows, VS_2024_SHEET), preferred).id).toBe("2025");
  });

  it("never FALLS BACK to 2019, whose comparison population is unconfirmed", () => {
    /*
     * The preference is honoured when the year exists — that is what a
     * preference is — and `preferredBaselineYear` can only ask for 2019 in
     * 2020. What must never happen is 2019 being REACHED by the fallback: a
     * preference nothing satisfies takes the newest UNCAVEATED year, and 2019
     * carries a caveat.
     */
    const windows = reportWindows(WITH_ROLLING, { currentYear: CURRENT });
    const unreachable = 2099;
    expect(defaultWindow(windowsForSheet(windows, VS_2024_SHEET), unreachable).id).toBe(
      "2024",
    );
  });

  it("scopes windows to one sheet on request", () => {
    const windows = reportWindows(WITH_ROLLING, { currentYear: CURRENT });
    expect(windowsForSheet(windows, ROLLING_SHEET).map((w) => w.id)).toEqual(["last_3m"]);
    expect(windowsForSheet(windows, VS_2024_SHEET).map((w) => w.id)).toEqual([
      "current",
      "2024",
      "2019",
    ]);
  });

  it("resolves a duplicate comparison to the earlier sheet, deterministically", () => {
    // Both sheets reporting `vs 2024` is not the current shape of the workbook,
    // but a merge with no tie-break would resolve by ingestion order — so which
    // sheet a figure came from would depend on which report arrived first.
    const both = [
      metric({ code: "total_revenue", sourceSheet: ROLLING_SHEET }),
      metric({ code: "total_revenue", sourceSheet: VS_2024_SHEET }),
    ];
    const windows = reportWindows(both, { currentYear: CURRENT });
    expect(findWindow(windows, "2024")?.sourceSheet).toBe(VS_2024_SHEET);
    expect(findWindow(windows, "current")?.sourceSheet).toBe(VS_2024_SHEET);
  });

  it("does not let a % change metric alone make Current selectable", () => {
    // A change is not a figure. A sheet holding only `total_revenue_pct_change`
    // at the current year cannot answer "what is Total Revenue this month".
    const changeOnly = [
      metric({
        code: "total_revenue_pct_change",
        comparisonOfCode: "total_revenue",
        availableBasisYears: [2024, 2026],
      }),
    ];
    const windows = reportWindows(changeOnly, { currentYear: CURRENT });
    expect(windows.some((window) => window.kind === "current")).toBe(false);
    expect(windows.map((window) => window.id)).toEqual(["2024"]);
  });
});

describe("selectableMeasureCodes", () => {
  it("drops a % change metric, because the window expresses it", () => {
    expect(selectableMeasureCodes(LIVE_SHAPED)).toEqual([
      "eft_revenue",
      "spa_sessions",
      "total_revenue",
    ]);
  });

  it("returns nothing for an empty catalogue", () => {
    expect(selectableMeasureCodes([])).toEqual([]);
  });
});

/**
 * ============================================================================
 * `vs 2025` — THE COMPARISON THE REVIEW ASKED FOR
 * ============================================================================
 *
 * "The comparison is set to vs. 2024, not 2025."
 *
 * The selection logic below was already right when that was written:
 * `preferredBaselineYear` derives the year before the current one, so it wanted
 * 2025 and asked for it. It got 2024 because no month-to-date sheet PRODUCED a
 * 2025 basis year — `CompReport(MTD) vs 2024` carries no 2025 column at all,
 * and `CompReport(MTD)`'s 2025 columns were outside the rolling parser's scope
 * — so `defaultWindow` fell through to its "newest uncaveated year" fallback
 * and landed on 2024, correctly and uselessly.
 *
 * These tests hold both halves: that the fallback still behaves that way when
 * 2025 is genuinely absent, and that the moment the facts exist the report
 * opens on it with no further change.
 */
describe("the 2025 comparison, once the source's own column is ingested", () => {
  /**
   * The live catalogue, the trailing windows, and the year comparison
   * `CompReport(MTD)` carries — which is the shape production holds once the
   * 2025 columns are ingested.
   */
  const WITH_2025: MetricDescriptor[] = [
    ...WITH_ROLLING,
    metric({
      code: "total_revenue",
      availableBasisYears: [2025, 2026],
      sourceSheet: ROLLING_SHEET,
    }),
    metric({
      code: "total_revenue_pct_change",
      label: "Total Revenue % Change",
      unit: "percent",
      comparisonOfCode: "total_revenue",
      availableBasisYears: [2025],
      sourceSheet: ROLLING_SHEET,
    }),
  ];

  it("offers vs 2025, and the review's other windows with it", () => {
    const windows = reportWindows(WITH_2025, { currentYear: CURRENT });
    const ids = windows.map((window) => window.id);

    expect(ids).toContain("2025");
    expect(ids).toContain("2024");
    expect(ids).toContain("2019");
    expect(ids).toContain("current");
    // Newest year first, so 2025 sits directly under Current MTD.
    expect(ids.indexOf("2025")).toBeLessThan(ids.indexOf("2024"));
    expect(ids.indexOf("2024")).toBeLessThan(ids.indexOf("2019"));
  });

  it("opens on vs 2025", () => {
    const windows = reportWindows(WITH_2025, { currentYear: CURRENT });
    const chosen = defaultWindow(windows, preferredBaselineYear(CURRENT));

    expect(preferredBaselineYear(CURRENT)).toBe(2025);
    expect(chosen.id).toBe("2025");
    expect(chosen.shortLabel).toBe("vs 2025");
    expect(chosen.caveat).toBeNull();
  });

  it("reads vs 2025 from the sheet that publishes TY vs. 2025 % Change", () => {
    const windows = reportWindows(WITH_2025, { currentYear: CURRENT });
    const vs2025 = windows.find((window) => window.id === "2025");
    const vs2024 = windows.find((window) => window.id === "2024");

    expect(vs2025?.sourceSheet).toBe(ROLLING_SHEET);
    // `vs 2024` keeps its own sheet and its own full-precision column.
    expect(vs2024?.sourceSheet).toBe(VS_2024_SHEET);
  });

  /**
   * The requirement that the CHART changes when the control does: each window
   * names a different stored fact, so nothing downstream can quietly show one
   * comparison under another's label.
   */
  it("changes which stored fact is read when the selection changes", () => {
    const windows = reportWindows(WITH_2025, { currentYear: CURRENT });
    const codesFor = (id: string) =>
      windowMetricCodes("total_revenue", windows.find((w) => w.id === id)!, CURRENT);

    const vs2025 = codesFor("2025");
    const vs2024 = codesFor("2024");
    const last3m = codesFor("last_3m");

    expect(vs2025.changeCode).toBe("total_revenue_pct_change");
    expect(vs2025.changeBasisYear).toBe(2025);
    expect(vs2025.baselineBasisYear).toBe(2025);

    expect(vs2024.changeCode).toBe("total_revenue_pct_change");
    expect(vs2024.changeBasisYear).toBe(2024);
    expect(vs2024.baselineBasisYear).toBe(2024);

    // Same code, different basis year: the two never read the same fact.
    expect(vs2025.changeBasisYear).not.toBe(vs2024.changeBasisYear);

    // A trailing window reads a different code entirely.
    expect(last3m.changeCode).toBe("total_revenue_last_3m_pct_change");
    expect(last3m.changeBasisYear).toBeNull();
  });

  it("still falls back to 2024 when the source really carries no 2025", () => {
    const windows = reportWindows(LIVE_SHAPED, { currentYear: CURRENT });
    const chosen = defaultWindow(windows, preferredBaselineYear(CURRENT));

    expect(windows.map((window) => window.id)).not.toContain("2025");
    expect(chosen.id).toBe("2024");
  });

  it("moves with the data rather than naming a year", () => {
    // The same catalogue read as a 2027 report prefers 2026, with no edit here.
    expect(preferredBaselineYear(2027)).toBe(2026);
    expect(preferredBaselineYear(2026)).toBe(2025);
  });
});

/**
 * ============================================================================
 * FOUR HEADLINE MEASURES UNDER `vs 2025`, AS UNDER `vs 2024`
 * ============================================================================
 *
 * Production showed `vs 2025` with Total Revenue alone, Total Tans reading
 * "Unavailable", and EFT Revenue and Unique Tanners dropped from the row —
 * because `CompReport(MTD)` was mapped for Total Revenue only. The sheet
 * carries all four, so the window has to offer all four.
 */
describe("the headline measures a window can answer", () => {
  /** The rolling sheet once all four of its comparison blocks are read. */
  const FOUR_MEASURES: MetricDescriptor[] = [
    ...WITH_ROLLING,
    /*
     * `LIVE_SHAPED` carries only three measures; the real year-comparison sheet
     * also publishes Total Tans (AP/AQ/AR) and Unique Tanners (AM/AN/AO), which
     * is why `vs 2024` shows four cards today. Added so the control is the
     * screen being compared against.
     */
    ...["total_tans", "unique_tanners"].flatMap((code) => [
      metric({ code, availableBasisYears: [2019, 2024, 2026], sourceSheet: VS_2024_SHEET }),
      metric({
        code: `${code}_pct_change`,
        unit: "percent",
        comparisonOfCode: code,
        availableBasisYears: [2019, 2024],
        sourceSheet: VS_2024_SHEET,
      }),
    ]),
    ...["total_revenue", "eft_revenue", "total_tans", "unique_tanners"].flatMap((code) => [
      metric({ code, availableBasisYears: [2025, 2026], sourceSheet: ROLLING_SHEET }),
      metric({
        code: `${code}_pct_change`,
        unit: "percent",
        comparisonOfCode: code,
        availableBasisYears: [2025],
        sourceSheet: ROLLING_SHEET,
      }),
    ]),
  ];

  const HEADLINE = ["total_revenue", "eft_revenue", "total_tans", "unique_tanners"] as const;

  it("answers all four under vs 2025", () => {
    const windows = reportWindows(FOUR_MEASURES, { currentYear: CURRENT });
    const vs2025 = windows.find((window) => window.id === "2025")!;

    for (const code of HEADLINE) {
      expect(windowAvailableFor(FOUR_MEASURES, code, vs2025, CURRENT), code).toBe(true);
    }
  });

  it("answers all four under vs 2024, unchanged", () => {
    const windows = reportWindows(FOUR_MEASURES, { currentYear: CURRENT });
    const vs2024 = windows.find((window) => window.id === "2024")!;

    /*
     * SCOPED TO THE SHEET, as every caller does. Both month-to-date sheets now
     * report Total Revenue, so an unscoped catalogue would answer about
     * whichever entry came last — which is why `report-context` filters by the
     * active sheet before asking.
     */
    const sheetCatalogue = FOUR_MEASURES.filter(
      (metric) => metric.sourceSheet === vs2024.sourceSheet,
    );

    for (const code of HEADLINE) {
      expect(windowAvailableFor(sheetCatalogue, code, vs2024, CURRENT), code).toBe(true);
    }
  });

  it("reads each measure's own 2025 change, never another's", () => {
    const windows = reportWindows(FOUR_MEASURES, { currentYear: CURRENT });
    const vs2025 = windows.find((window) => window.id === "2025")!;

    for (const code of HEADLINE) {
      const codes = windowMetricCodes(code, vs2025, CURRENT);
      expect(codes.currentCode).toBe(code);
      expect(codes.baselineCode).toBe(code);
      expect(codes.changeCode).toBe(`${code}_pct_change`);
      expect(codes.baselineBasisYear).toBe(2025);
      expect(codes.currentBasisYear).toBe(CURRENT);
    }
  });

  /**
   * A MISSING BASELINE MUST NOT HIDE A PRESENT FIGURE. This is the property the
   * production screen got wrong, and it holds independently of whether the
   * source happens to carry the baseline today.
   */
  it("keeps a measure selectable when its figure exists and its baseline does not", () => {
    const figureOnly: MetricDescriptor[] = [
      metric({ code: "total_tans", availableBasisYears: [2026], sourceSheet: ROLLING_SHEET }),
    ];
    const window = basisYearWindow(2025, ROLLING_SHEET);

    expect(windowAvailableFor(figureOnly, "total_tans", window, CURRENT)).toBe(true);
  });

  it("drops a measure only when the figure itself is absent", () => {
    const baselineOnly: MetricDescriptor[] = [
      metric({ code: "total_tans", availableBasisYears: [2025], sourceSheet: ROLLING_SHEET }),
    ];
    const window = basisYearWindow(2025, ROLLING_SHEET);

    expect(windowAvailableFor(baselineOnly, "total_tans", window, CURRENT)).toBe(false);
  });

  it("still opens on vs 2025", () => {
    const windows = reportWindows(FOUR_MEASURES, { currentYear: CURRENT });
    expect(defaultWindow(windows, preferredBaselineYear(CURRENT)).id).toBe("2025");
  });
});

/**
 * ============================================================================
 * A FIGURE CANNOT CONJURE A COMPARISON WINDOW
 * ============================================================================
 *
 * `windowAvailableFor` was relaxed so a measure with a current figure and no
 * baseline keeps its card. The reasonable worry is that the same relaxation
 * leaks upward and makes a WINDOW appear for a year the source never reported —
 * offering `vs 2019` because 2026 figures exist.
 *
 * It cannot, and the reason is structural rather than careful: window discovery
 * and metric availability are different functions reading different things.
 * `reportWindows` builds a year window only from `availableBasisYears`, which
 * exist because facts carry that year. `windowAvailableFor` is asked afterwards,
 * about a window that already exists. These tests hold that separation.
 */
describe("window discovery is independent of metric availability", () => {
  it("offers no year window when no fact carries a past year", () => {
    const currentOnly: MetricDescriptor[] = [
      metric({ code: "total_revenue", availableBasisYears: [CURRENT], sourceSheet: VS_2024_SHEET }),
      metric({ code: "spa_sessions", availableBasisYears: [CURRENT], sourceSheet: VS_2024_SHEET }),
    ];

    const windows = reportWindows(currentOnly, { currentYear: CURRENT });

    expect(windows.every((window) => window.kind !== "basis_year")).toBe(true);
    expect(windows.map((window) => window.id)).not.toContain("2019");
    expect(windows.map((window) => window.id)).not.toContain("2025");
  });

  it("offers a year window only for the years facts actually carry", () => {
    const some: MetricDescriptor[] = [
      metric({
        code: "total_revenue",
        availableBasisYears: [2024, CURRENT],
        sourceSheet: VS_2024_SHEET,
      }),
    ];

    const ids = reportWindows(some, { currentYear: CURRENT }).map((window) => window.id);

    expect(ids).toContain("2024");
    expect(ids).not.toContain("2019");
    expect(ids).not.toContain("2025");
  });

  /**
   * The `spa_sessions` case, stated as the two facts it actually is: the 2019
   * window exists because OTHER measures report 2019, and spa sessions is
   * visible inside it without a comparison. The window was not created for it.
   */
  it("keeps a measure with no baseline inside a window other measures created", () => {
    const windows = reportWindows(LIVE_SHAPED, { currentYear: CURRENT });
    const vs2019 = windows.find((window) => window.id === "2019");

    // The window exists because total_revenue and others carry 2019 facts.
    expect(vs2019).toBeDefined();
    expect(
      LIVE_SHAPED.some((m) => m.code !== "spa_sessions" && m.availableBasisYears.includes(2019)),
    ).toBe(true);
    // Spa sessions does not, and is shown inside that window without one.
    expect(
      LIVE_SHAPED.find((m) => m.code === "spa_sessions")!.availableBasisYears.includes(2019),
    ).toBe(false);
    expect(windowAvailableFor(LIVE_SHAPED, "spa_sessions", vs2019!, CURRENT)).toBe(true);
  });

  it("removes the window entirely when the last 2019 fact goes", () => {
    const without = LIVE_SHAPED.map((m) => ({
      ...m,
      availableBasisYears: m.availableBasisYears.filter((year) => year !== 2019),
    }));

    expect(reportWindows(without, { currentYear: CURRENT }).map((w) => w.id)).not.toContain("2019");
  });
});
