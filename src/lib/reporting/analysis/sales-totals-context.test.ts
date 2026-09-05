import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SalesTotalsSnapshot,
  SalesTotalsSubject,
} from "../read/sales-totals-read";

/**
 * ============================================================================
 * WHAT ASK SUNNY IS TOLD ABOUT A REPORT, AND WHAT IT IS NEVER TOLD
 * ============================================================================
 *
 * The grounding block is the whole attack surface of this feature: the model
 * cannot know anything this text does not say, and it will believe everything
 * it does. So the four semantic rules the dashboard enforces are asserted HERE,
 * against the text itself, rather than trusted to survive the trip.
 *
 * The figures below are the real 09-02-2026 shape, reduced to three salons so
 * the arithmetic can be checked by eye:
 *
 *   Aurora    Grand Total  1,000.00   PPTA 2.50   Tans 100
 *   Bayside   Grand Total    500.50   PPTA 3.00   Tans  60
 *   Cedar     Grand Total  (blank)    PPTA 2.00   Tans  40
 *
 * Cedar's blank is the interesting row. It is "not reported", which is NOT
 * zero, and every assertion about missing data below turns on it.
 */

const READ_MODULE = "../read/sales-totals-read";

function figure(code: string, value: number | null) {
  const meta: Record<string, { label: string; unit: "currency" | "count"; agg: "sum" | "average" }> = {
    grand_total: { label: "Grand Total", unit: "currency", agg: "sum" },
    ppta: { label: "PPTA", unit: "currency", agg: "average" },
    tans: { label: "Tans", unit: "count", agg: "sum" },
    efts: { label: "EFTs", unit: "count", agg: "sum" },
    new_customers: { label: "New Customers", unit: "count", agg: "sum" },
    sunless_sessions: { label: "Sunless Sessions", unit: "count", agg: "sum" },
  };
  const entry = meta[code]!;
  return {
    metricCode: code,
    metricLabel: entry.label,
    unit: entry.unit,
    aggregation: entry.agg,
    summaryIsAverage: true,
    note: "",
    value,
  };
}

function salon(
  key: string,
  label: string,
  values: Record<string, number | null>,
): SalesTotalsSubject {
  return {
    kind: "salon",
    key,
    label,
    salonNumber: key,
    salonCount: null,
    figures: Object.entries(values).map(([code, value]) => figure(code, value)),
  };
}

const SNAPSHOT: SalesTotalsSnapshot = {
  reportDate: "2026-09-02",
  reportDateRaw: "09-02-2026",
  monthStart: "2026-09-01",
  window: "daily",
  windowLabel: "Previous Day",
  windowDescription: "The single day the report covers.",
  summaries: [
    {
      kind: "summary",
      key: "all_salons",
      label: "All Salons",
      salonNumber: null,
      salonCount: 249,
      figures: [figure("grand_total", 818.45), figure("ppta", 2.3), figure("tans", 71)],
    },
    {
      kind: "summary",
      key: "stc_consolidated",
      label: "STC Consolidated",
      salonNumber: null,
      salonCount: 98,
      figures: [figure("grand_total", 734.5), figure("ppta", 2.25), figure("tans", 64)],
    },
  ],
  salons: [
    salon("1001", "Aurora", { grand_total: 1000, ppta: 2.5, tans: 100 }),
    salon("1002", "Bayside", { grand_total: 500.5, ppta: 3, tans: 60 }),
    salon("1003", "Cedar", { grand_total: null, ppta: 2, tans: 40 }),
  ],
  lineage: { parserKey: "sales_totals_v1", parserVersion: 1, ingestedAt: null },
};

/** Every date/window pair the fake read layer was asked for. */
let reads: { reportDate: string; window: string }[] = [];

beforeEach(() => {
  reads = [];
});

afterEach(() => {
  vi.doUnmock(READ_MODULE);
  vi.resetModules();
});

async function resolve(
  request: Record<string, unknown> = {},
  options: { snapshot?: SalesTotalsSnapshot | null; dates?: { reportDate: string }[] } = {},
) {
  vi.resetModules();

  const dates = options.dates ?? [{ reportDate: "2026-09-02" }, { reportDate: "2026-09-01" }];
  const snapshot = options.snapshot === undefined ? SNAPSHOT : options.snapshot;

  vi.doMock(READ_MODULE, async () => {
    const actual = await vi.importActual<typeof import("../read/sales-totals-read")>(
      READ_MODULE,
    );
    return {
      ...actual,
      listSalesTotalsDates: async () =>
        dates.map((date) => ({
          reportDate: date.reportDate,
          reportDateRaw: date.reportDate,
          monthStart: "2026-09-01",
          label: date.reportDate,
          ingestedAt: null,
        })),
      loadSalesTotals: async (options: { reportDate: string; window: string }) => {
        reads.push(options);
        if (!snapshot) return null;
        return { ...snapshot, window: options.window };
      },
    };
  });

  const { resolveSalesTotalsAnalysisContext } = await import("./sales-totals-context");
  return resolveSalesTotalsAnalysisContext(request);
}

async function grounding(request: Record<string, unknown> = {}): Promise<string> {
  const result = await resolve(request);
  if (!result.ok) throw new Error(`expected a resolved context, got ${result.failure}`);
  return result.grounding;
}

/* ------------------------------------------------- one date, one window -- */

describe("MTD is already cumulative, so one snapshot is all that is read", () => {
  it("reads exactly one report date for one question", async () => {
    await grounding({ reportDate: "2026-09-02" });
    expect(reads).toEqual([{ reportDate: "2026-09-02", window: "daily" }]);
  });

  it("reads one date even when several are available", async () => {
    await grounding({ window: "mtd" });
    expect(reads).toHaveLength(1);
    expect(reads[0].window).toBe("mtd");
  });

  it("tells the model there is no other date in the context", async () => {
    const text = await grounding();
    expect(text).toMatch(/no trend, change or comparison over time can be stated/i);
  });

  it("states that month-to-date figures are never added across dates", async () => {
    const text = await grounding({ window: "mtd" });
    expect(text).toMatch(/already cumulative/i);
    expect(text).toMatch(/never added across dates/i);
  });

  it("states that the two windows are never combined", async () => {
    const text = await grounding();
    expect(text).toMatch(/never combined/i);
  });
});

/* ------------------------------------------------------ two populations -- */

describe("estate summary figures are averages, and are labelled as averages", () => {
  it("names the estate figure an average per salon, never a total", async () => {
    const text = await grounding({ estateSummaryKey: "all_salons" });
    const section = text.slice(text.indexOf("SELECTED ESTATE SUMMARY"));
    expect(section).toMatch(/Average sales per salon: \$818\.45/);
    expect(section).not.toMatch(/Total sales: \$818\.45/);
  });

  it("says outright that the estate block is per-salon averages, not totals", async () => {
    const text = await grounding({ estateSummaryKey: "all_salons" });
    expect(text).toMatch(/PER-SALON AVERAGES/);
    expect(text).toMatch(/not totals/i);
  });

  it("forbids adding the estate figures to this delivery's salon figures", async () => {
    const text = await grounding({ estateSummaryKey: "all_salons" });
    expect(text).toMatch(/must never be added to, subtracted from, or directly compared/i);
  });

  it("keeps the two populations in separate labelled sections", async () => {
    const text = await grounding({ estateSummaryKey: "all_salons" });
    expect(text.indexOf("SALON FIGURES")).toBeGreaterThan(-1);
    expect(text.indexOf("SELECTED ESTATE SUMMARY")).toBeGreaterThan(
      text.indexOf("SALON FIGURES"),
    );
  });

  it("never derives the estate figure from the salon rows", async () => {
    // The three salons total 1,500.50. The estate average is 818.45. If the
    // context had computed one from the other, the reported figure would move.
    const text = await grounding({ estateSummaryKey: "all_salons" });
    expect(text).toContain("$818.45");
    expect(text).toContain("$1,500.50");
  });
});

/* ---------------------------------------------------------------- PPTA -- */

describe("PPTA is not combined across salons", () => {
  it("marks the combined PPTA unavailable rather than printing a number", async () => {
    const text = await grounding();
    const line = text
      .split("\n")
      .find((row) => row.startsWith("- PPTA") && row.includes("NOT AVAILABLE"));
    expect(line).toBeDefined();
    // The plain mean of 2.50, 3.00 and 2.00 is 2.50 — the number a careless
    // implementation would have produced. It must not appear as a combined PPTA.
    expect(line).not.toMatch(/\$2\.50/);
  });

  it("passes through the aggregate layer's own reason, not a paraphrase", async () => {
    const text = await grounding();
    expect(text).toMatch(/needs each salon's transaction count as a weight/);
  });

  it("tells the model to report the limitation instead of estimating one", async () => {
    const text = await grounding();
    expect(text).toMatch(/Where a combined figure is marked NOT AVAILABLE, say so rather than estimating/i);
  });

  it("still reports a single salon's own PPTA, which is not an aggregation", async () => {
    const text = await grounding({ salonIds: ["1001"] });
    // Scoped to the combined block: the DATA RULES section always mentions the
    // NOT AVAILABLE marker, and matching the whole document would pass on that
    // sentence rather than on the figure being tested.
    const combined = text.slice(
      text.indexOf("COMBINED FIGURES"),
      text.indexOf("RANKING BY"),
    );
    expect(combined).toMatch(/- PPTA: \$2\.50/);
    expect(combined).not.toMatch(/NOT AVAILABLE/);
  });
});

/* ------------------------------------------------------- missing is not zero */

describe("a blank cell is not reported, and is never a zero", () => {
  it("renders a missing salon figure as not reported", async () => {
    const text = await grounding();
    const cedar = text.split("\n").find((row) => row.startsWith("- Cedar"))!;
    expect(cedar).toContain("Grand Total: not reported");
    expect(cedar).not.toMatch(/Grand Total: \$0/);
  });

  it("excludes the missing salon from the total rather than adding a zero", async () => {
    const text = await grounding();
    // 1000.00 + 500.50, with Cedar excluded entirely.
    expect(text).toMatch(/Total sales: \$1,500\.50/);
  });

  it("says how many of the selected salons actually reported", async () => {
    const text = await grounding();
    expect(text).toMatch(/2 of 3 salons reported — the rest did not report this measure and are NOT counted as zero/);
  });

  it("leaves an unreported salon out of the ranking instead of ranking it last", async () => {
    const text = await grounding({ metric: "grand_total" });
    const ranking = text.slice(text.indexOf("RANKING BY GRAND TOTAL"));
    expect(ranking).toContain("Aurora");
    expect(ranking).toContain("Bayside");
    expect(ranking).not.toContain("Cedar");
    expect(ranking).toMatch(/salons that did not report it are absent/i);
  });

  it("states the rule in the data rules block as well as in the figures", async () => {
    const text = await grounding();
    expect(text).toMatch(/It is NOT zero/);
    expect(text).toMatch(/must not be described as having sold nothing/i);
  });
});

/* ------------------------------------------------------------ selection -- */

describe("the selection the reader made is the selection that is analysed", () => {
  it("treats an empty salon filter as every salon in the delivery", async () => {
    const result = await resolve({ salonIds: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provenance.salonCount).toBe(3);
    expect(result.provenance.isAllSalons).toBe(true);
    expect(result.grounding).toMatch(/no salon filter is applied, so this is every salon/);
  });

  it("drops a salon number that is not in this delivery rather than inventing a row", async () => {
    const result = await resolve({ salonIds: ["1001", "9999"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provenance.salonCount).toBe(1);
    expect(result.grounding).not.toContain("9999");
  });

  it("reports the provenance of what was actually read", async () => {
    const result = await resolve({ reportDate: "2026-09-02", window: "mtd", metric: "tans" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provenance).toMatchObject({
      reportType: "Sales Totals",
      reportDate: "2026-09-02",
      window: "mtd",
      selectedMetric: "Tans",
    });
  });
});

/* -------------------------------------------------------------- failures -- */

describe("a view that cannot be resolved says so instead of guessing", () => {
  it("reports no_reports when nothing has ever been ingested", async () => {
    const result = await resolve({}, { dates: [] });
    expect(result).toEqual({ ok: false, failure: "no_reports" });
  });

  it("reports no_snapshot when that date and window hold nothing", async () => {
    const result = await resolve({}, { snapshot: null });
    expect(result).toEqual({ ok: false, failure: "no_snapshot" });
  });

  it("reports no_salon_data when the snapshot carries no salon rows", async () => {
    const result = await resolve({}, { snapshot: { ...SNAPSHOT, salons: [] } });
    expect(result).toEqual({ ok: false, failure: "no_salon_data" });
  });
});

/* -------------------------------------------- no re-upload, no retrieval -- */

describe("an already-ingested snapshot is analysed as it stands", () => {
  /**
   * THE REGRESSION THIS MILESTONE EXISTS TO PREVENT: somebody making report
   * analysis work by routing report rows through the knowledge base, or by
   * asking the reader to re-attach the morning email.
   *
   * The context resolver reads the reporting tables and nothing else. If a
   * retrieval provider, an embedding call or an upload ever appears in this
   * path, one of these fails.
   */
  it("produces a full grounding block from the stored snapshot alone", async () => {
    const text = await grounding();
    expect(text).toContain("Sales Totals (daily email delivery)");
    expect(text).toContain("Aurora");
    expect(reads).toEqual([{ reportDate: "2026-09-02", window: "daily" }]);
  });

  it("does not import the knowledge base, embeddings or ingestion", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/reporting/analysis/sales-totals-context.ts", "utf8"),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/knowledge/i);
    expect(code).not.toMatch(/embedding/i);
    expect(code).not.toMatch(/ingest/i);
    expect(code).not.toMatch(/upload/i);
  });
});
