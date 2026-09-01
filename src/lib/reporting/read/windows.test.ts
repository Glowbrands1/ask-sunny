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

  it("refuses spa sessions against 2019, the real gap in the workbook", () => {
    expect(
      windowAvailableFor(LIVE_SHAPED, "spa_sessions", basisYearWindow(2019), CURRENT),
    ).toBe(false);
    // The current figure is there, so only the COMPARISON is unavailable.
    expect(windowAvailableFor(LIVE_SHAPED, "spa_sessions", currentWindow(), CURRENT)).toBe(true);
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

  it("gives each sheet its own default: 2024 on one, Last 3 Months on the other", () => {
    const windows = reportWindows(WITH_ROLLING, { currentYear: CURRENT });
    expect(defaultWindowForSheet(windows, VS_2024_SHEET)?.id).toBe("2024");
    expect(defaultWindowForSheet(windows, ROLLING_SHEET)?.id).toBe("last_3m");
    // A sheet with nothing loaded has no default, rather than borrowing one.
    expect(defaultWindowForSheet(windows, "CompReport(YTD)")).toBeNull();
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
