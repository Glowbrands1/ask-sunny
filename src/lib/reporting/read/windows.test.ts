import { describe, expect, it } from "vitest";

import type { MetricDescriptor } from "./types";
import {
  basisYearWindow,
  currentWindow,
  defaultWindow,
  findWindow,
  isWindowToken,
  reportWindows,
  rollingWindow,
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

const WITH_ROLLING: MetricDescriptor[] = [
  ...LIVE_SHAPED,
  metric({
    code: "total_revenue_last_3m_current",
    label: "Revenue, current year last 3 months",
    basisYearRequired: false,
    availableBasisYears: [],
    factCount: 15,
  }),
  metric({
    code: "total_revenue_last_3m_prior",
    label: "Revenue, prior year last 3 months",
    basisYearRequired: false,
    availableBasisYears: [],
    factCount: 15,
  }),
  metric({
    code: "total_revenue_last_3m_pct_change",
    label: "Last 3 Months % Change",
    unit: "percent",
    basisYearRequired: false,
    comparisonOfCode: "total_revenue",
    availableBasisYears: [],
    factCount: 15,
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
