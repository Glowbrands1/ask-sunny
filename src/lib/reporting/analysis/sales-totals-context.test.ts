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

/**
 * Just the RANKING block.
 *
 * The grounding grew computed-signal sections AFTER the ranking, and those
 * sections deliberately name the salons that did not report a measure — that
 * is the point of them. So an assertion about who is absent from the RANKING
 * has to stop at the ranking's own boundary rather than running to the end of
 * the document.
 */
function rankingSection(text: string): string {
  const start = text.indexOf("RANKING BY");
  const end = text.indexOf("SELECTED-METRIC SIGNALS");
  return text.slice(start, end === -1 ? undefined : end);
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
    // Scoped to the RANKING section itself. The computed-signal sections that
    // follow name unreported salons on purpose — to say they did not report —
    // so a slice running to the end of the document would test the wrong text.
    const ranking = rankingSection(text);
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

/* -------------------------------------------- bounding a large selection -- */

describe("a delivery larger than the cap keeps BOTH ends of the ranking", () => {
  /**
   * ==========================================================================
   * THE ROWS A LARGE DELIVERY IS ACTUALLY ASKED ABOUT
   * ==========================================================================
   *
   * The previous implementation ordered high to low and took the first sixty
   * while its own comment claimed it kept both extremes. It kept the top. So on
   * a delivery of seventy salons, "which salons need attention?" was answered
   * from a context that had removed every salon needing attention — and the
   * grounding text then asserted the omitted rows lay between the extremes,
   * which was false.
   *
   * Seventy salons: sixty-eight report Grand Total with distinct descending
   * values, and two report nothing. The two unreported ones are the interesting
   * case, because "lowest" and "did not report" must not become the same thing.
   */
  const LARGE_SALONS: SalesTotalsSubject[] = [
    ...Array.from({ length: 68 }, (_, index) =>
      salon(`2${String(index).padStart(3, "0")}`, `Salon ${String(index).padStart(2, "0")}`, {
        grand_total: 10_000 - index * 100,
        tans: 500 - index,
      }),
    ),
    salon("2900", "Blank Alpha", { grand_total: null, tans: 5 }),
    salon("2901", "Blank Beta", { grand_total: null, tans: 6 }),
  ];

  const LARGE_SNAPSHOT: SalesTotalsSnapshot = { ...SNAPSHOT, salons: LARGE_SALONS };

  async function largeGrounding(): Promise<string> {
    const result = await resolve({ metric: "grand_total" }, { snapshot: LARGE_SNAPSHOT });
    if (!result.ok) throw new Error(`expected a resolved context, got ${result.failure}`);
    return result.grounding;
  }

  /** Just the SALON FIGURES block, which is what the cap applies to. */
  function salonBlock(text: string): string {
    return text.slice(text.indexOf("SALON FIGURES"), text.indexOf("COMBINED FIGURES"));
  }

  it("lists the highest performer", async () => {
    // Salon 00 at $10,000.00 — the top of the ranking.
    expect(salonBlock(await largeGrounding())).toMatch(/- Salon 00 \(#2000\)/);
  });

  it("lists the LOWEST performer, which the old bound dropped", async () => {
    // Salon 67 at $3,300.00 — the bottom of the ranking, and the row behind
    // "which salons need attention?".
    expect(salonBlock(await largeGrounding())).toMatch(/- Salon 67 \(#2067\)/);
  });

  it("keeps a run of salons at each end rather than one token row", async () => {
    const block = salonBlock(await largeGrounding());
    for (const name of ["Salon 00", "Salon 01", "Salon 02", "Salon 65", "Salon 66", "Salon 67"]) {
      expect(block).toContain(name);
    }
  });

  it("drops from the middle, which is where an omitted row is least missed", async () => {
    const block = salonBlock(await largeGrounding());
    expect(block).not.toContain("Salon 34");
  });

  it("never lists a salon twice", async () => {
    const block = salonBlock(await largeGrounding());
    const listed = [...block.matchAll(/^- (.+?) \(#/gm)].map((match) => match[1]);
    expect(listed.length).toBe(new Set(listed).size);
  });

  it("stays inside the cap", async () => {
    const block = salonBlock(await largeGrounding());
    const listed = [...block.matchAll(/^- .+? \(#/gm)];
    expect(listed.length).toBeLessThanOrEqual(60);
    expect(block).toMatch(/SALON FIGURES \(60 of 70 selected salons\)/);
  });

  it("keeps salons that did not report the measure, and does not rank them", async () => {
    const block = salonBlock(await largeGrounding());
    // They must survive the cap...
    expect(block).toContain("Blank Alpha");
    expect(block).toContain("Grand Total: not reported");
    // ...and must not be presented as the bottom of the ranking.
    expect(rankingSection(await largeGrounding())).not.toContain("Blank Alpha");
  });

  it("says only of the RANKED omissions that they fall between the extremes", async () => {
    const note = salonBlock(await largeGrounding());
    expect(note).toMatch(/reported Grand Total and are not listed above/);
    expect(note).toMatch(/every omitted salon falls between them/);
  });

  it("describes unreported omissions separately, as having no position at all", async () => {
    // With 68 ranked salons and a 60-row cap the two blanks both fit, so this
    // asserts the wording is not applied to them rather than that it appears.
    const note = salonBlock(await largeGrounding());
    expect(note).not.toMatch(/did not report Grand Total are also not listed/);
  });

  it("lists both ends on a different measure when the metric changes", async () => {
    // Tans ranks all seventy salons, so the extremes move. Bounding must follow
    // the SELECTED measure, not a fixed order.
    const result = await resolve({ metric: "tans" }, { snapshot: LARGE_SNAPSHOT });
    if (!result.ok) throw new Error("expected a resolved context");
    const block = salonBlock(result.grounding);

    expect(block).toContain("Salon 00");     // 500 tans, highest
    expect(block).toContain("Blank Alpha");  // 5 tans, lowest
  });
});

/* ------------------------------------------ deterministic signals in text -- */

describe("the grounding carries computed signals, not an invitation to eyeball", () => {
  /**
   * ==========================================================================
   * WHAT LIVE QA CAUGHT
   * ==========================================================================
   *
   * Asked "what should I look at first?" on a Grand Total view, the answer
   * came back with "start with the two ends of the ranking, then the PPTA
   * column", "this is where the row-to-row differences are widest", and "a few
   * salons show high tan volume alongside low takings".
   *
   * Every one of those was the model doing statistics by eye. The middle one
   * was also arithmetically void — it compared a range in dollars against a
   * range in dollars-per-transaction against a range in session counts.
   *
   * So the context now hands over the comparisons already made. These tests
   * assert they are there, that they carry their basis, and that the one
   * comparison that cannot be made is absent.
   */

  /** Just the selected-measure signal block. */
  function selectedSignals(text: string): string {
    return text.slice(
      text.indexOf("SELECTED-METRIC SIGNALS"),
      text.indexOf("OTHER MEASURES IN THIS VIEW"),
    );
  }

  it("puts the selected measure's block before the other measures", async () => {
    /*
     * THE ORDERING IS THE MECHANISM, not decoration. RULE 1 of this
     * remediation — lead with the measure the manager selected — is
     * implemented by this sequence: six equally-presented distributions is
     * exactly the context that let a Grand Total question get answered with a
     * paragraph about PPTA.
     */
    const text = await grounding({ metric: "grand_total" });
    const selected = text.indexOf("SELECTED-METRIC SIGNALS");
    const others = text.indexOf("OTHER MEASURES IN THIS VIEW");

    expect(selected).toBeGreaterThan(-1);
    expect(others).toBeGreaterThan(selected);
  });

  it("names the selected measure as the primary analysis", async () => {
    const block = selectedSignals(await grounding({ metric: "grand_total" }));
    expect(block).toMatch(/SELECTED-METRIC SIGNALS — Grand Total/);
    expect(block).toMatch(/the primary analysis for any broad question about this view/);
  });

  it("follows the selected measure when it changes", async () => {
    const block = selectedSignals(await grounding({ metric: "tans" }));
    expect(block).toMatch(/SELECTED-METRIC SIGNALS — Tans/);
  });

  it("marks the other measures as descriptive and not a reason to lead with them", async () => {
    const text = await grounding({ metric: "grand_total" });
    expect(text).toMatch(/OTHER MEASURES IN THIS VIEW \(descriptive only/);
    expect(text).toMatch(/NOT a reason to lead with them/);
    // And PPTA is over there, not in the primary block.
    expect(selectedSignals(text)).not.toMatch(/SELECTED-METRIC SIGNALS — PPTA/);
  });

  it("states the median of the reporting salons", async () => {
    // Aurora 1000, Bayside 500.50, Cedar not reported -> median of two.
    const block = selectedSignals(await grounding({ metric: "grand_total" }));
    expect(block).toMatch(/Median of the 2 reporting salons: \$750\.25/);
  });

  it("gives every salon a rank with its denominator", async () => {
    const block = selectedSignals(await grounding({ metric: "grand_total" }));
    expect(block).toMatch(/- Aurora \(#1001\) — \$1,000\.00 \| rank 1 of 2 reporting/);
    expect(block).toMatch(/- Bayside \(#1002\) — \$500\.50 \| rank 2 of 2 reporting/);
  });

  it("gives every salon its distance from the median", async () => {
    const block = selectedSignals(await grounding({ metric: "grand_total" }));
    expect(block).toMatch(/\+\$249\.75 vs median/);
    expect(block).toMatch(/-\$249\.75 vs median/);
  });

  it("says outright that quartiles need four reporting salons", async () => {
    const block = selectedSignals(await grounding({ metric: "grand_total" }));
    expect(block).toMatch(/Quartiles are not reported: 2 reporting salons cannot be divided into quarters/);
  });

  it("labels quartiles once the population supports them", async () => {
    const many = {
      ...SNAPSHOT,
      salons: Array.from({ length: 8 }, (_, index) =>
        salon(`3${index}`, `Store ${index}`, { grand_total: 1000 - index * 100 }),
      ),
    };
    const result = await resolve({ metric: "grand_total" }, { snapshot: many });
    if (!result.ok) throw new Error("expected a resolved context");
    const block = selectedSignals(result.grounding);

    expect(block).toMatch(/rank 1 of 8 reporting \| top quartile/);
    expect(block).toMatch(/rank 8 of 8 reporting \| bottom quartile/);
    expect(block).toMatch(/upper-middle quartile/);
    expect(block).toMatch(/lower-middle quartile/);
  });

  it("keeps the unreported salons out of the signal figures and names them", async () => {
    const block = selectedSignals(await grounding({ metric: "grand_total" }));
    expect(block).toMatch(/3 selected salons, 2 reported Grand Total, 1 did not/);
    expect(block).toMatch(/They are NOT zero and NOT the bottom of the ranking/);
    expect(block).toMatch(/Did not report Grand Total: Cedar \(#1003\)\./);
  });

  it("states the absence of a performance baseline as a data rule", async () => {
    const text = await grounding();
    expect(text).toMatch(/THERE IS NO PERFORMANCE BASELINE IN THIS CONTEXT/);
    expect(text).toMatch(/no target, no budget, no forecast, no prior period/);
    expect(text).toMatch(/cannot establish that any salon is underperforming, weak, in trouble, or doing well/);
  });

  it("forbids ranking the measures against each other by spread", async () => {
    const text = await grounding();
    expect(text).toMatch(/Do NOT rank the measures against each other by spread, range or variability/);
    expect(text).toMatch(/different units/);
  });

  it("computes no cross-metric spread comparison anywhere in the text", async () => {
    const text = (await grounding()).toLowerCase();
    // The prohibition itself uses the words, so this checks for the SHAPE of a
    // claim: a measure named as having the widest or largest spread.
    expect(text).not.toMatch(/(widest|largest|biggest) (spread|range|variability|variation)/);
    expect(text).not.toMatch(/coefficient of variation|standard deviation|z-score|interquartile/);
  });

  it("applies no evaluative label to any salon", async () => {
    /*
     * Scoped to the FIGURES AND SIGNALS, stopping at DATA RULES — the same
     * pattern that keeps catching this codebase out. The rules block PROHIBITS
     * the word "underperforming", so matching the whole document would fail on
     * the prohibition rather than on a verdict. What must be clean is the part
     * that describes salons.
     */
    const text = await grounding();
    const described = text.slice(0, text.indexOf("DATA RULES")).toLowerCase();

    for (const banned of [
      "underperform",
      "poor performance",
      "strong performer",
      "needs attention",
      "weak",
      "concerning",
    ]) {
      expect(described).not.toContain(banned);
    }
  });
});

/* --------------------------------------------- PPTA in the other-measures -- */

describe("PPTA's distribution is described without becoming a business figure", () => {
  function otherMeasures(text: string): string {
    const start = text.indexOf("OTHER MEASURES IN THIS VIEW");
    const end = text.indexOf("SELECTED ESTATE SUMMARY");
    return text.slice(start, end === -1 ? undefined : end);
  }

  it("labels the median as the median of the reported per-salon values", async () => {
    const block = otherMeasures(await grounding({ metric: "grand_total" }));
    expect(block).toMatch(/PPTA: 3 of 3 reported/);
    expect(block).toMatch(/median of the reported per-salon values \$2\.50/);
  });

  it("says in the same breath that it is not a combined figure", async () => {
    const block = otherMeasures(await grounding({ metric: "grand_total" }));
    const ppta = block.split("\n").find((line) => line.startsWith("- PPTA"))!;

    expect(ppta).toMatch(/NOT A COMBINED FIGURE/);
    expect(ppta).toMatch(/neither its total nor the median of the per-salon values is this delivery's PPTA/);
    expect(ppta).toMatch(/describe the SPREAD of individual salon values and nothing more/);
  });

  it("never prints a summed PPTA", async () => {
    const block = otherMeasures(await grounding({ metric: "grand_total" }));
    const ppta = block.split("\n").find((line) => line.startsWith("- PPTA"))!;
    // 2.50 + 3.00 + 2.00 = 7.50, the number a careless sum would produce.
    expect(ppta).not.toContain("$7.50");
    expect(ppta).not.toMatch(/total \$/);
  });

  it("does give a total for a summable measure", async () => {
    const block = otherMeasures(await grounding({ metric: "grand_total" }));
    const tans = block.split("\n").find((line) => line.startsWith("- Tans"))!;
    expect(tans).toMatch(/total 200/);
  });

  it("puts PPTA in the primary block when PPTA is the selected measure", async () => {
    const text = await grounding({ metric: "ppta" });
    const block = text.slice(
      text.indexOf("SELECTED-METRIC SIGNALS"),
      text.indexOf("OTHER MEASURES IN THIS VIEW"),
    );
    expect(block).toMatch(/SELECTED-METRIC SIGNALS — PPTA/);
    // Still refused a combined figure, even as the headline measure.
    expect(block).toMatch(/No combined figure for this measure/);
    expect(block).toMatch(/transaction count as a weight/);
  });
});

/* ---------------------------------------------- the median-percent wording -- */

describe("a deviation is stated as a relative change, never as a proportion", () => {
  /**
   * ==========================================================================
   * THE WORDING BUG
   * ==========================================================================
   *
   * The deviation was rendered as "+67% of the median". A value $400 above a
   * median of $600 is 67% ABOVE the median and 167% OF it — so the phrasing
   * named the right number with the wrong relation, and read as though the
   * salon sat below the median when it was comfortably above.
   *
   * The arithmetic was right the whole time. Only the sentence was wrong,
   * which is the kind of defect a numeric test suite passes straight over and
   * a manager reads intact.
   */
  const SPREAD: SalesTotalsSnapshot = {
    ...SNAPSHOT,
    salons: [
      salon("2001", "High", { grand_total: 1000 }),
      salon("2002", "Middle", { grand_total: 600 }),
      salon("2003", "Low", { grand_total: 400 }),
    ],
  };

  async function spreadBlock(): Promise<string> {
    const result = await resolve({ metric: "grand_total" }, { snapshot: SPREAD });
    if (!result.ok) throw new Error("expected a resolved context");
    return result.grounding.slice(
      result.grounding.indexOf("SELECTED-METRIC SIGNALS"),
      result.grounding.indexOf("OTHER MEASURES IN THIS VIEW"),
    );
  }

  it("describes 1000 against a median of 600 as 67% ABOVE the median", async () => {
    const block = await spreadBlock();
    expect(block).toMatch(/Median of the 3 reporting salons: \$600\.00/);
    expect(block).toMatch(/- High \(#2001\).*\+\$400\.00 vs median \(67% above median\)/);
  });

  it("does not describe it as 67% OF the median, which would be a different claim", async () => {
    const block = await spreadBlock();
    expect(block).not.toMatch(/67% of the median/);
    expect(block).not.toMatch(/% of the median/);
  });

  it("describes 400 against a median of 600 as 33% BELOW the median", async () => {
    const block = await spreadBlock();
    expect(block).toMatch(/- Low \(#2003\).*-\$200\.00 vs median \(33% below median\)/);
  });

  it("never signs the percentage as well as naming its direction", async () => {
    // "(-33% below median)" would read as a double negative.
    const block = await spreadBlock();
    expect(block).not.toMatch(/\(-\d+% (above|below) median\)/);
    expect(block).not.toMatch(/\(\+\d+% (above|below) median\)/);
  });

  it("says a salon on the median is equal to it, with no percentage at all", async () => {
    const block = await spreadBlock();
    expect(block).toMatch(/- Middle \(#2002\).*equal to the median/);
    // No "+$0.00 vs median (0% above median)", which is technically true and
    // reads as though something had been measured.
    expect(block).not.toMatch(/0% (above|below) median/);
    expect(block).not.toMatch(/\+\$0\.00 vs median/);
  });

  it("says the percentage is undefined rather than showing 0% when the median is zero", async () => {
    const zeroMedian: SalesTotalsSnapshot = {
      ...SNAPSHOT,
      salons: [
        salon("3001", "Some", { grand_total: 100 }),
        salon("3002", "None", { grand_total: 0 }),
        salon("3003", "Nil", { grand_total: 0 }),
      ],
    };
    const result = await resolve({ metric: "grand_total" }, { snapshot: zeroMedian });
    if (!result.ok) throw new Error("expected a resolved context");

    expect(result.grounding).toMatch(/so a percentage difference is undefined/);
    expect(result.grounding).not.toMatch(/Infinity|NaN/);
  });
});

/* ------------------------------------------------------ ties in the text -- */

describe("a tied end is never presented as uniquely held", () => {
  const TIED_TOP: SalesTotalsSnapshot = {
    ...SNAPSHOT,
    salons: [
      salon("4001", "Alpha", { grand_total: 1000 }),
      salon("4002", "Bravo", { grand_total: 1000 }),
      salon("4003", "Charlie", { grand_total: 500 }),
    ],
  };

  const TIED_BOTTOM: SalesTotalsSnapshot = {
    ...SNAPSHOT,
    salons: [
      salon("5001", "Alpha", { grand_total: 1000 }),
      salon("5002", "Bravo", { grand_total: 500 }),
      salon("5003", "Charlie", { grand_total: 500 }),
    ],
  };

  async function blockFor(snapshot: SalesTotalsSnapshot): Promise<string> {
    const result = await resolve({ metric: "grand_total" }, { snapshot });
    if (!result.ok) throw new Error("expected a resolved context");
    return result.grounding.slice(
      result.grounding.indexOf("SELECTED-METRIC SIGNALS"),
      result.grounding.indexOf("OTHER MEASURES IN THIS VIEW"),
    );
  }

  it("names both salons tied for highest, and says they are tied", async () => {
    const block = await blockFor(TIED_TOP);
    expect(block).toMatch(
      /Highest reported: \$1,000\.00 — Alpha \(#4001\) and Bravo \(#4002\), tied at rank 1 of 3\./,
    );
  });

  it("names both salons tied for lowest, and says they are tied", async () => {
    const block = await blockFor(TIED_BOTTOM);
    expect(block).toMatch(
      /Lowest reported: \$500\.00 — Bravo \(#5002\) and Charlie \(#5003\), tied at rank 2 of 3\./,
    );
  });

  it("keeps the plain wording when an end really is held by one salon", async () => {
    const block = await blockFor(TIED_TOP);
    expect(block).toMatch(/Lowest reported: \$500\.00 — Charlie \(#4003\), rank 3 of 3\./);
    expect(block).not.toMatch(/Lowest reported.*tied/);
  });

  it("gives tied salons the same rank in the per-salon lines", async () => {
    const block = await blockFor(TIED_TOP);
    expect(block).toMatch(/- Alpha \(#4001\) — \$1,000\.00 \| rank 1 of 3/);
    expect(block).toMatch(/- Bravo \(#4002\) — \$1,000\.00 \| rank 1 of 3/);
    // And the next distinct value skips the rank the tie consumed.
    expect(block).toMatch(/- Charlie \(#4003\) — \$500\.00 \| rank 3 of 3/);
  });

  it("refuses to describe two ends when every salon reported the same figure", async () => {
    const identical: SalesTotalsSnapshot = {
      ...SNAPSHOT,
      salons: ["6001", "6002", "6003"].map((key) =>
        salon(key, `Store ${key}`, { grand_total: 750 }),
      ),
    };
    const block = await blockFor(identical);

    expect(block).toMatch(
      /All 3 reporting salons reported the same Grand Total: \$750\.00\. There is no highest or lowest/,
    );
    expect(block).not.toMatch(/Highest reported/);
    expect(block).not.toMatch(/Lowest reported/);
  });

  it("counts a tie rather than naming one salon in the other-measures summary", async () => {
    const result = await resolve({ metric: "tans" }, { snapshot: TIED_TOP });
    if (!result.ok) throw new Error("expected a resolved context");
    const others = result.grounding.slice(result.grounding.indexOf("OTHER MEASURES IN THIS VIEW"));
    const line = others.split("\n").find((entry) => entry.startsWith("- Grand Total"))!;

    expect(line).toMatch(/highest \$1,000\.00 \(2 salons tied\)/);
  });
});
