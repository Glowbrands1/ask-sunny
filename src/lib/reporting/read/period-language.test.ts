import { describe, expect, it } from "vitest";

import {
  detectPeriodIntent,
  resolvePeriod,
  type ResolvablePeriod,
} from "./period-language";
import {
  REPORT_FAMILIES_BY_ID,
  type ReportFamily,
  type ReportPeriodTypeId,
} from "./report-families";

/**
 * ============================================================================
 * PERIODS RESOLVE FROM THE DATA, AND NOTHING HERE KNOWS WHAT MONTH IT IS
 * ============================================================================
 *
 * The requirement this suite exists to prove is a future one: September, then
 * October, then November arrive and "latest" moves with them, with no code and
 * no config edited in between. So every fixture below is built from a
 * PARAMETER, and the assertions are about RELATIONSHIPS — the newest, the one
 * before it, the one whose month was named — never about a literal month.
 *
 * A test that asserted "latest is August" would pass today and be the thing
 * that had to be edited in October, which is precisely the failure being
 * designed out.
 *
 * `THIS_YEAR` and `NEXT_YEAR` are computed from the wall clock for the same
 * reason. They are only used to show that the resolution is indifferent to
 * which year it is.
 */

const THIS_YEAR = new Date().getUTCFullYear();
const NEXT_YEAR = THIS_YEAR + 1;

/** A month-to-date period ending on the last day of a month. */
function mtd(year: number, month: number): ResolvablePeriod {
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  return {
    id: `mtd:${end}`,
    type: "mtd",
    start,
    end,
    label: `${MONTHS[month - 1]} ${year}`,
  };
}

function ytd(year: number, throughMonth: number): ResolvablePeriod {
  const end = new Date(Date.UTC(year, throughMonth, 0)).toISOString().slice(0, 10);
  return {
    id: `ytd:${end}`,
    type: "ytd",
    start: `${year}-01-01`,
    end,
    label: `YTD ${String(throughMonth).padStart(2, "0")} ${year}`,
  };
}

function ltm(year: number, throughMonth: number): ResolvablePeriod {
  const end = new Date(Date.UTC(year, throughMonth, 0)).toISOString().slice(0, 10);
  return {
    id: `ltm:${end}`,
    type: "ltm",
    start: `${year - 1}-${String(throughMonth).padStart(2, "0")}-01`,
    end,
    label: `LTM through ${end}`,
  };
}

/** A daily Sales Totals delivery, plus the month-to-date window beside it. */
function delivery(year: number, month: number, day: number): ResolvablePeriod[] {
  const end = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return [
    { id: `${end}:daily`, type: "daily", start: end, end, label: end },
    {
      id: `${end}:mtd`,
      type: "mtd",
      start: `${year}-${String(month).padStart(2, "0")}-01`,
      end,
      label: `${end} month to date`,
    },
  ];
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const BED_USAGE = REPORT_FAMILIES_BY_ID["bed-usage"];
const SALON_PERFORMANCE = REPORT_FAMILIES_BY_ID["salon-performance"];
const SPA_WELLNESS = REPORT_FAMILIES_BY_ID["spa-wellness"];
const SALES_TOTALS = REPORT_FAMILIES_BY_ID["sales-totals"];

function resolve(
  family: ReportFamily,
  periods: readonly ResolvablePeriod[],
  question: string | null,
) {
  return resolvePeriod({
    family,
    periods,
    intent: question === null ? null : detectPeriodIntent(question),
  });
}

/* ============================================================== detection == */

describe("the window a question asked for", () => {
  const CASES: [string, string][] = [
    ["What is our latest bed usage?", "latest"],
    ["Show me the most recent delivery", "latest"],
    ["How did we do last month?", "previous"],
    ["What about the previous month?", "previous"],
    ["How are we doing this month?", "month_to_date"],
    ["What is our MTD revenue?", "month_to_date"],
    ["Show me month to date", "month_to_date"],
    ["How is our YTD tracking?", "year_to_date"],
    ["What about year to date?", "year_to_date"],
    ["How are we doing so far this year?", "year_to_date"],
    ["What do the last twelve months look like?", "last_twelve_months"],
    ["Show me LTM spa usage", "last_twelve_months"],
    ["How was July?", "named_month"],
    ["What happened in October?", "named_month"],
  ];

  for (const [question, kind] of CASES) {
    it(`reads "${question}" as ${kind}`, () => {
      expect(detectPeriodIntent(question)?.kind).toBe(kind);
    });
  }

  it("takes a year only when it directly follows the month", () => {
    /*
     * "August" in a sentence that also mentions 2024 as a COMPARISON BASIS must
     * not silently become August 2024 — the Comp Report's whole vs-2024 window
     * is phrased that way.
     */
    expect(detectPeriodIntent("How was August 2025?")).toMatchObject({
      kind: "named_month",
      month: 8,
      year: 2025,
    });
    expect(detectPeriodIntent("How was August against 2024?")).toMatchObject({
      kind: "named_month",
      month: 8,
      year: null,
    });
  });

  it("prefers an explicit window over a month it happens to name", () => {
    // "August year to date" is a year-to-date question that names where it ends.
    expect(detectPeriodIntent("What is our August year to date?")?.kind).toBe("year_to_date");
  });

  it("reads no window from a question that names none", () => {
    for (const question of [
      "What should I focus on?",
      "Why is Spa weak?",
      "What is the dress code?",
      "",
    ]) {
      expect(detectPeriodIntent(question), question).toBeNull();
    }
  });

  it("does not read a month out of an ordinary word", () => {
    /*
     * `mar`, `may`, `jun` and `aug` are absent as ABBREVIATIONS because they
     * are English, and `may` needs a year or a preposition even as a full name
     * — it is the one month that is also a modal verb, and it appears in
     * ordinary management sentences constantly.
     *
     * `sep`/`sept`/`oct`/`nov`/`dec` are matched bare and that is deliberate:
     * they are shorthand managers actually type, and they are not words. A
     * contrived sentence containing one is not a case worth distorting the
     * vocabulary for.
     */
    for (const question of [
      "We may need to coach her",
      "She may have missed the tour",
      "Policy may require a second signature",
      "Can you mar the finish?",
      "How do I augment the schedule?",
    ]) {
      const intent = detectPeriodIntent(question);
      expect(intent?.kind === "named_month" ? intent.phrase : null, question).toBeNull();
    }
  });

  it("reads May as a month when a year or a preposition says so", () => {
    expect(detectPeriodIntent("How was May 2026?")).toMatchObject({
      kind: "named_month",
      month: 5,
      year: 2026,
    });
    expect(detectPeriodIntent("What happened in May?")).toMatchObject({
      kind: "named_month",
      month: 5,
      year: null,
    });
  });

  it("reads the question only, never the history", () => {
    expect(detectPeriodIntent.length).toBe(1);
  });

  it("does not treat today or yesterday as a period selector", () => {
    /*
     * DELIBERATE. No family delivers a period for today, so mapping the word
     * onto one would let Sunny imply it holds figures for a day that has not
     * arrived. Freshness handles it honestly instead.
     */
    expect(detectPeriodIntent("How are we doing today?")).toBeNull();
    expect(detectPeriodIntent("What happened yesterday?")).toBeNull();
  });
});

/* ============================================================== resolution == */

describe("latest resolves to the newest stored period, whatever it is", () => {
  it("moves when a newer period is added, with nothing edited", () => {
    const august = mtd(THIS_YEAR, 8);
    const september = mtd(THIS_YEAR, 9);
    const october = mtd(THIS_YEAR, 10);

    const one = resolve(BED_USAGE, [august], "latest");
    expect(one.ok && one.period.end).toBe(august.end);

    const two = resolve(BED_USAGE, [august, september], "latest");
    expect(two.ok && two.period.end).toBe(september.end);

    const three = resolve(BED_USAGE, [august, september, october], "latest");
    expect(three.ok && three.period.end).toBe(october.end);
  });

  it("crosses a year boundary without a code change", () => {
    const december = mtd(THIS_YEAR, 12);
    const january = mtd(NEXT_YEAR, 1);
    const result = resolve(BED_USAGE, [december, january], "latest");
    expect(result.ok && result.period.end).toBe(january.end);
  });

  it("is unaffected by the order the periods arrive in", () => {
    const periods = [mtd(THIS_YEAR, 8), mtd(THIS_YEAR, 10), mtd(THIS_YEAR, 9)];
    const result = resolve(BED_USAGE, periods, "latest");
    expect(result.ok && result.period.end).toBe(mtd(THIS_YEAR, 10).end);
  });
});

describe("a question with no window falls back to the newest, and says so", () => {
  it("reports the fallback rather than hiding it", () => {
    const result = resolve(BED_USAGE, [mtd(THIS_YEAR, 8), mtd(THIS_YEAR, 9)], null);
    expect(result.ok).toBe(true);
    expect(result.ok && result.fellBackToLatest).toBe(true);
    expect(result.ok && result.period.end).toBe(mtd(THIS_YEAR, 9).end);
  });

  it("does not report a fallback when the question said latest outright", () => {
    const result = resolve(BED_USAGE, [mtd(THIS_YEAR, 9)], "latest");
    expect(result.ok && result.fellBackToLatest).toBe(false);
  });
});

describe("last month is the period before the newest, not the second row", () => {
  it("resolves to the previous month", () => {
    const august = mtd(THIS_YEAR, 8);
    const september = mtd(THIS_YEAR, 9);
    const result = resolve(BED_USAGE, [august, september], "How did we do last month?");
    expect(result.ok && result.period.end).toBe(august.end);
  });

  it("moves when October lands, with nothing edited", () => {
    const periods = [mtd(THIS_YEAR, 8), mtd(THIS_YEAR, 9), mtd(THIS_YEAR, 10)];
    const result = resolve(BED_USAGE, periods, "last month");
    expect(result.ok && result.period.end).toBe(mtd(THIS_YEAR, 9).end);
  });

  it("ignores a different WINDOW ending on the same day", () => {
    /*
     * Spa Wellness holds MTD, YTD and LTM all ending on the month's last day.
     * "The second period" there is the same month read over a year — which is
     * the mistake `GRAIN_PRECEDENCE` in `bed-spa/read.ts` was written to stop a
     * tab making, and it must not reappear here.
     */
    const periods = [
      mtd(THIS_YEAR, 9),
      ytd(THIS_YEAR, 9),
      ltm(THIS_YEAR, 9),
      mtd(THIS_YEAR, 8),
    ];
    const result = resolve(SPA_WELLNESS, periods, "last month");
    expect(result.ok && result.period.type).toBe("mtd");
    expect(result.ok && result.period.end).toBe(mtd(THIS_YEAR, 8).end);
  });

  it("for a DAILY family means an earlier month, not yesterday", () => {
    /*
     * Sales Totals arrives every morning, so "the previous delivery" is
     * yesterday. "Last month" has to mean a delivery from an earlier month or
     * the phrase is answered with the wrong span entirely.
     */
    const periods = [
      ...delivery(THIS_YEAR, 9, 3),
      ...delivery(THIS_YEAR, 9, 2),
      ...delivery(THIS_YEAR, 8, 31),
    ];
    const result = resolve(SALES_TOTALS, periods, "How did we do last month?");
    expect(result.ok && result.period.end).toBe(`${THIS_YEAR}-08-31`);
    expect(result.ok && result.period.type).toBe("daily");
  });

  it("refuses when there is only one period, and says why", () => {
    const result = resolve(BED_USAGE, [mtd(THIS_YEAR, 9)], "last month");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("no_previous_period");
    expect(!result.ok && result.failure.detail).toContain("no earlier one");
  });
});

describe("MTD, YTD and LTM select by window, where the source delivers one", () => {
  const periods = [mtd(THIS_YEAR, 9), ytd(THIS_YEAR, 9), ltm(THIS_YEAR, 9)];

  it("resolves month to date", () => {
    const result = resolve(SPA_WELLNESS, periods, "What is our MTD spa usage?");
    expect(result.ok && result.period.type).toBe("mtd");
  });

  it("resolves year to date", () => {
    const result = resolve(SPA_WELLNESS, periods, "What about year to date?");
    expect(result.ok && result.period.type).toBe("ytd");
    expect(result.ok && result.period.start).toBe(`${THIS_YEAR}-01-01`);
  });

  it("resolves last twelve months", () => {
    const result = resolve(SPA_WELLNESS, periods, "Show me the last twelve months");
    expect(result.ok && result.period.type).toBe("ltm");
  });

  it("refuses a window the source does not deliver, and names what it does", () => {
    /*
     * THE ASSERTION THAT KEEPS AN ANSWER HONEST. Bed Usage is a monthly report
     * with no year-to-date sheet. Handing back its month under a year-to-date
     * question would be a figure a twelfth of the size of the one asked for.
     */
    const result = resolve(BED_USAGE, [mtd(THIS_YEAR, 9)], "What is our YTD bed usage?");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("type_not_delivered");
    expect(!result.ok && result.failure.detail).toContain("does not deliver year to date");
    expect(!result.ok && result.failure.detail).toContain("month to date");
  });

  it("refuses a window the source delivers but has not loaded", () => {
    const result = resolve(
      SALON_PERFORMANCE,
      [mtd(THIS_YEAR, 9)],
      "What about year to date?",
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("period_not_ingested");
    // It names what IS loaded, so the answer can offer the alternative.
    expect(!result.ok && result.failure.detail).toContain("Loaded periods");
  });
});

describe("a named month resolves against what was ingested", () => {
  it("finds the month, in any year, when only one is loaded", () => {
    const periods = [mtd(THIS_YEAR, 7), mtd(THIS_YEAR, 8), mtd(THIS_YEAR, 9)];
    const result = resolve(BED_USAGE, periods, "How was July?");
    expect(result.ok && result.period.end).toBe(mtd(THIS_YEAR, 7).end);
  });

  it("respects an explicit year", () => {
    const periods = [mtd(THIS_YEAR, 8), mtd(THIS_YEAR - 1, 8)];
    const result = resolve(BED_USAGE, periods, `How was August ${THIS_YEAR - 1}?`);
    expect(result.ok && result.period.end).toBe(mtd(THIS_YEAR - 1, 8).end);
  });

  it("prefers the family's default window for that month", () => {
    // Not the twelve-month accumulation that happens to end on the same day.
    const periods = [ltm(THIS_YEAR, 9), ytd(THIS_YEAR, 9), mtd(THIS_YEAR, 9)];
    const result = resolve(SPA_WELLNESS, periods, "How was September?");
    expect(result.ok && result.period.type).toBe("mtd");
  });

  it("refuses a month that has not been ingested, and lists what has", () => {
    const result = resolve(BED_USAGE, [mtd(THIS_YEAR, 9)], "How was February?");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("period_not_ingested");
    expect(!result.ok && result.failure.detail).toContain("Loaded periods");
  });
});

describe("nothing ingested is its own reason", () => {
  it("says so rather than refusing the window", () => {
    const result = resolve(BED_USAGE, [], "last month");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("no_periods");
    expect(!result.ok && result.failure.detail).toContain("Bed Usage");
  });

  it("reports it even when the question named no window", () => {
    const result = resolve(BED_USAGE, [], null);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("no_periods");
  });
});

describe("no month, year or clock is baked into this module", () => {
  it("holds no four-digit year and no month name in its source", async () => {
    /*
     * The structural version of the whole requirement. A literal year or month
     * in the resolution logic is exactly how `CURRENT_BASIS_YEAR = 2026` and
     * `DEMO_ANCHOR = "2026-08-26"` froze time in this codebase before.
     *
     * The month NAMES are legitimate — they are the vocabulary a manager types
     * — so the assertion is on the resolution half of the file, after the
     * detection tables.
     */
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/reporting/read/period-language.ts", "utf8");
    const resolutionHalf = source.slice(source.indexOf("/* ---") + 1).slice(
      source.slice(source.indexOf("/* ---") + 1).indexOf("export function resolvePeriod"),
    );

    expect(resolutionHalf).not.toMatch(/\b20\d{2}\b/);
    expect(resolutionHalf).not.toMatch(/new Date\(\)/);
    expect(resolutionHalf).not.toContain("DEMO_ANCHOR");
    expect(resolutionHalf).not.toContain("Date.now");
  });

  it("is a pure function of the periods it is given", () => {
    // Same inputs, same answer, whenever it runs.
    const periods = [mtd(THIS_YEAR, 8), mtd(THIS_YEAR, 9)];
    const once = resolve(BED_USAGE, periods, "last month");
    const twice = resolve(BED_USAGE, periods, "last month");
    expect(once).toEqual(twice);
  });
});

describe("every family's declared windows are ones its source delivers", () => {
  it("names a default window first, and only known window types", () => {
    const known: ReportPeriodTypeId[] = ["daily", "mtd", "ytd", "ltm"];
    for (const family of Object.values(REPORT_FAMILIES_BY_ID)) {
      expect(family.periodTypes.length, family.id).toBeGreaterThan(0);
      for (const type of family.periodTypes) {
        expect(known, `${family.id}: ${type}`).toContain(type);
      }
    }
  });

  it("puts the day first for the daily report and the month first elsewhere", () => {
    /*
     * The ordering is load-bearing: it is what a question naming no window
     * resolves to. "What happened?" on Sales Totals means yesterday, and a
     * month-to-date default would answer a different question with a bigger
     * number.
     */
    expect(SALES_TOTALS.periodTypes[0]).toBe("daily");
    for (const id of ["salon-performance", "bed-usage", "spa-wellness", "spa-engagement"] as const) {
      expect(REPORT_FAMILIES_BY_ID[id].periodTypes[0], id).toBe("mtd");
    }
  });
});
