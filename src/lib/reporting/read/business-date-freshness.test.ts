import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { businessToday, daysBetween } from "@/lib/business-date";

import { FRESHNESS_RULE, buildFreshnessBlock, familyFreshness } from "./report-freshness";
import { detectPeriodIntent, resolvePeriod } from "./period-language";
import { REPORT_FAMILIES_BY_ID } from "./report-families";
import type { CatalogPeriod } from "./report-catalog";

/**
 * ============================================================================
 * WHICH DAY THE FRESHNESS CHECK IS MEASURING FROM
 * ============================================================================
 *
 * "How far behind today is this report?" has two dates in it, and until this
 * suite existed only one of them was tested. The report's as-of date comes from
 * the workbook and carries no zone at all. TODAY was the UTC date, and the UTC
 * date rolls over at 8pm Eastern in summer.
 *
 * THE BUG THAT MAKES: every evening, for four or five hours, a delivery
 * covering the day the manager is standing in reports as ONE DAY BEHIND, and
 * `FRESHNESS_RULE` then instructs Sunny to open with an apology for figures
 * that are in fact current. The same slip runs the other way at month end,
 * where a month-to-date delivery is called stale on the first evening of the
 * next month.
 *
 * So there are three separate claims here, and they are separate describes:
 *
 *   1. THE REPORTING DAY does not move when the UTC date does.
 *   2. FRESHNESS is still right about every lag it reports — the fix must not
 *      have bought the evening at the cost of the arithmetic.
 *   3. LATEST PERIOD RESOLUTION is untouched by any of it. The stored period is
 *      authoritative; the clock does not get a vote in which one is newest.
 *
 * NOTHING HERE READS THE REAL CLOCK. Every instant is passed in, so the suite
 * asserts the same thing at 3am in CI as it does at noon on a laptop.
 */

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

/** The UTC calendar date of an instant — what the code used to use for "today". */
function utcDate(instant: string): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/** A delivery ending on `end`, in the shape the catalog hands to freshness. */
function delivery(
  end: string,
  overrides: Partial<CatalogPeriod> = {},
): CatalogPeriod {
  return {
    id: `daily:${end}`,
    type: "daily",
    start: end,
    end,
    label: end,
    ingestedAt: `${end}T06:15:00Z`,
    salonCount: 15,
    ...overrides,
  };
}

const SALES_TOTALS = REPORT_FAMILIES_BY_ID["sales-totals"];
const BED_USAGE = REPORT_FAMILIES_BY_ID["bed-usage"];

describe("the reporting day near UTC midnight", () => {
  /*
   * 2026-09-04 is a Friday in US summer time; Eastern is UTC-4, so the UTC date
   * rolls at 20:00 local. Every instant below is the SAME working evening at a
   * salon on the 4th.
   */
  const THAT_EVENING = [
    "2026-09-04T22:00:00Z", // 6pm Eastern
    "2026-09-05T00:00:00Z", // 8pm Eastern — UTC has just rolled over
    "2026-09-05T02:00:00Z", // 10pm Eastern
    "2026-09-05T03:59:00Z", // 11:59pm Eastern
  ];

  it("stays on one date for the whole evening, while UTC moves mid-way through", () => {
    for (const instant of THAT_EVENING) {
      expect(businessToday(new Date(instant)), instant).toBe("2026-09-04");
    }
    // The premise: UTC really does disagree for three of those four instants,
    // so this is not a test of a distinction that does not exist.
    expect(THAT_EVENING.map(utcDate)).toEqual([
      "2026-09-04",
      "2026-09-05",
      "2026-09-05",
      "2026-09-05",
    ]);
  });

  it("rolls at business midnight, so the next morning is genuinely the next day", () => {
    expect(businessToday(new Date("2026-09-05T04:00:00Z"))).toBe("2026-09-05");
    expect(businessToday(new Date("2026-09-05T11:00:00Z"))).toBe("2026-09-05");
  });

  it("does not call a delivery covering today 'one day behind' at 10pm", () => {
    const latest = delivery("2026-09-04");

    const business = familyFreshness({
      family: SALES_TOTALS,
      latest,
      today: businessToday(new Date("2026-09-05T02:00:00Z")),
    });

    expect(business.daysBehind).toBe(0);
    expect(business.level).toBe("current");
    expect(business.sentence).toContain("the day being asked about");

    /*
     * WHAT THE OLD CODE DID, asserted so the difference is visible rather than
     * asserted in the abstract. Same instant, same delivery, UTC date instead —
     * a report covering the manager's own day, reported as behind.
     */
    const naive = familyFreshness({
      family: SALES_TOTALS,
      latest,
      today: utcDate("2026-09-05T02:00:00Z"),
    });
    expect(naive.daysBehind).toBe(1);
    expect(naive.level).toBe("one_day_behind");
  });

  it("does not add a phantom day to a real lag, at any hour of that evening", () => {
    // A delivery three days back stays three days back all evening. Before the
    // fix it became four for the last four hours of every day.
    const latest = delivery("2026-09-01");
    for (const instant of THAT_EVENING) {
      const freshness = familyFreshness({
        family: SALES_TOTALS,
        latest,
        today: businessToday(new Date(instant)),
      });
      expect(freshness.daysBehind, instant).toBe(3);
      expect(freshness.level, instant).toBe("days_behind");
    }
  });

  it("does not push a month-to-date delivery into the next month on the first evening", () => {
    /*
     * 2026-10-01T02:00Z is 10pm Eastern on 30 September. A September
     * month-to-date delivery through the 30th is CURRENT at that moment; the UTC
     * date would put the manager in October and make it a day behind — which
     * reads, in an answer, as "September has closed" a day before it has.
     */
    const september = delivery("2026-09-30", {
      id: "mtd:2026-09-30",
      type: "mtd",
      start: "2026-09-01",
      label: "September 2026",
    });

    const today = businessToday(new Date("2026-10-01T02:00:00Z"));
    expect(today).toBe("2026-09-30");
    expect(familyFreshness({ family: BED_USAGE, latest: september, today }).level).toBe(
      "current",
    );
  });

  it("survives the daylight-saving change, because Intl owns the offset", () => {
    // Eastern is UTC-5 in December, so the UTC date rolls at 7pm local — an hour
    // earlier than in September. Hard-coded arithmetic gets this wrong twice a
    // year; nothing here does the arithmetic.
    const today = businessToday(new Date("2026-12-05T04:30:00Z"));
    expect(today).toBe("2026-12-04");
    expect(
      familyFreshness({ family: SALES_TOTALS, latest: delivery("2026-12-04"), today }).level,
    ).toBe("current");
  });

  it("gives the same answer whatever zone the container happens to be in", () => {
    const instant = new Date("2026-09-05T02:00:00Z");
    for (const zone of ["UTC", "Pacific/Kiritimati", "Pacific/Midway", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      const freshness = familyFreshness({
        family: SALES_TOTALS,
        latest: delivery("2026-09-04"),
        today: businessToday(instant),
      });
      expect(freshness.level, zone).toBe("current");
      expect(freshness.daysBehind, zone).toBe(0);
    }
  });

  it("is computed in one module, and freshness reads no clock and no zone of its own", () => {
    /*
     * THE STRUCTURAL HALF OF THE FIX. The behaviour above can be restored by
     * accident the moment any of these three modules reaches for a clock: a
     * `new Date()` here would reintroduce the host's zone, and a second
     * `NEXT_PUBLIC_BUSINESS_TIMEZONE` read would be a second opinion about what
     * day it is. The date arrives as a parameter, from `lib/business-date`.
     */
    for (const name of ["report-freshness", "period-language", "report-catalog"]) {
      const code = readFileSync(`src/lib/reporting/read/${name}.ts`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, name).not.toMatch(/new Date\(/);
      expect(code, name).not.toMatch(/Date\.now/);
      expect(code, name).not.toMatch(/TIMEZONE/);
      expect(code, name).not.toMatch(/DEMO_ANCHOR/);
    }
  });
});

describe("freshness is still right about every lag it reports", () => {
  const cases = [
    { end: "2026-09-09", level: "current", days: 0 },
    { end: "2026-09-08", level: "one_day_behind", days: 1 },
    { end: "2026-09-07", level: "one_day_behind", days: 2 },
    { end: "2026-09-06", level: "days_behind", days: 3 },
    { end: "2026-08-09", level: "days_behind", days: 31 },
    { end: "2026-08-08", level: "months_behind", days: 32 },
  ] as const;

  it.each(cases)("is $level when the newest figures end $end", ({ end, level, days }) => {
    const freshness = familyFreshness({
      family: SALES_TOTALS,
      latest: delivery(end),
      today: "2026-09-09",
    });
    expect(freshness.daysBehind).toBe(days);
    expect(freshness.level).toBe(level);
    expect(freshness.asOf).toBe(end);
  });

  it("measures the lag with the shared day count, not a second implementation", () => {
    // The identity, so a future local copy of the arithmetic diverging from
    // `lib/business-date` fails here rather than in an answer.
    for (const { end, days } of cases) {
      expect(daysBetween(end, "2026-09-09"), end).toBe(days);
    }
  });

  it("names the as-of date, the window and the load time in one sentence", () => {
    const freshness = familyFreshness({
      family: BED_USAGE,
      latest: delivery("2026-08-31", {
        type: "mtd",
        start: "2026-08-01",
        label: "August 2026",
        ingestedAt: "2026-09-01T06:00:00Z",
      }),
      today: "2026-09-09",
    });

    expect(freshness.sentence).toContain("Bed Usage");
    expect(freshness.sentence).toContain("2026-08-31");
    expect(freshness.sentence).toContain("month to date");
    expect(freshness.sentence).toContain("2026-09-01T06:00:00Z");
    expect(freshness.periodLabel).toBe("August 2026");
  });

  it("says nothing about a load time that was never recorded", () => {
    const freshness = familyFreshness({
      family: SALES_TOTALS,
      latest: delivery("2026-09-08", { ingestedAt: null }),
      today: "2026-09-09",
    });
    expect(freshness.ingestedAt).toBeNull();
    expect(freshness.sentence).not.toContain("loaded");
  });

  it("reports an absent family as absent, and names where it would come from", () => {
    const freshness = familyFreshness({
      family: BED_USAGE,
      latest: null,
      today: "2026-09-09",
    });
    expect(freshness.level).toBe("absent");
    expect(freshness.asOf).toBeNull();
    expect(freshness.daysBehind).toBeNull();
    expect(freshness.sentence).toContain(BED_USAGE.sourceReport);
  });

  it("does not report a negative lag when a period runs past the day asked about", () => {
    /*
     * A month-to-date period ending on the month's last day, read mid-month.
     * It covers the day being asked about, which is "current" — what it must
     * never be is "21 days before the day being asked about", which is what the
     * lag sentence would read if the count were rendered without regard to its
     * sign. The count itself stays signed, because that is the honest answer to
     * "how far apart are these two dates"; it is the SENTENCE that must not
     * quote it.
     */
    const freshness = familyFreshness({
      family: BED_USAGE,
      latest: delivery("2026-09-30", { type: "mtd", start: "2026-09-01" }),
      today: "2026-09-09",
    });
    expect(freshness.level).toBe("current");
    expect(freshness.daysBehind).toBeLessThan(0);
    expect(freshness.sentence).not.toMatch(/days before/);
    expect(freshness.sentence).toContain("which is the day being asked about");
  });

  it("carries the staleness instruction only when something actually is behind", () => {
    const behind = buildFreshnessBlock([
      familyFreshness({ family: SALES_TOTALS, latest: delivery("2026-09-03"), today: "2026-09-09" }),
    ]);
    expect(behind).toContain(FRESHNESS_RULE);

    const current = buildFreshnessBlock([
      familyFreshness({ family: SALES_TOTALS, latest: delivery("2026-09-09"), today: "2026-09-09" }),
    ]);
    expect(current).not.toContain(FRESHNESS_RULE);
    expect(current).toContain("covers the day being asked about");
  });

  it("is silent when every requested family is absent, because the no-data rule already said so", () => {
    expect(
      buildFreshnessBlock([
        familyFreshness({ family: SALES_TOTALS, latest: null, today: "2026-09-09" }),
        familyFreshness({ family: BED_USAGE, latest: null, today: "2026-09-09" }),
      ]),
    ).toBeNull();
  });
});

describe("the stored period stays authoritative, whatever the clock says", () => {
  /*
   * THE ONE THING THE TIMEZONE WORK MUST NOT HAVE TOUCHED. Freshness compares a
   * period against a day; resolution CHOOSES a period, and it chooses from the
   * rows the catalog returned and nothing else. If a zone or a clock could
   * change which period is "latest", then a question asked at 10pm would read a
   * different month than the same question asked at 10am.
   */
  const periods: CatalogPeriod[] = [
    delivery("2026-09-04"),
    delivery("2026-09-03"),
    delivery("2026-08-31"),
    delivery("2026-08-01"),
  ];

  const ZONES = ["UTC", "Pacific/Kiritimati", "Pacific/Midway", "America/Los_Angeles"];

  it("reads the same newest period in every host zone", () => {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      const resolved = resolvePeriod({ family: SALES_TOTALS, periods, intent: null });
      expect(resolved.ok, zone).toBe(true);
      if (resolved.ok) {
        expect(resolved.period.end, zone).toBe("2026-09-04");
        expect(resolved.fellBackToLatest, zone).toBe(true);
      }
    }
  });

  it("reads the same period for 'latest', 'last month' and a named month in every host zone", () => {
    for (const zone of ZONES) {
      process.env.TZ = zone;

      const latest = resolvePeriod({
        family: SALES_TOTALS,
        periods,
        intent: detectPeriodIntent("what do the latest numbers say"),
      });
      const previous = resolvePeriod({
        family: SALES_TOTALS,
        periods,
        intent: detectPeriodIntent("how did we do last month"),
      });
      const named = resolvePeriod({
        family: SALES_TOTALS,
        periods,
        intent: detectPeriodIntent("how did August look"),
      });

      expect(latest.ok && latest.period.end, zone).toBe("2026-09-04");
      // "Last month" from a DAILY family is the newest delivery of an earlier
      // month, not yesterday — and that is a property of the rows, not the date.
      expect(previous.ok && previous.period.end, zone).toBe("2026-08-31");
      expect(named.ok && named.period.end, zone).toBe("2026-08-31");
    }
  });

  it("still reads the newest stored period when it ends after the business day", () => {
    /*
     * THE USER'S RULE, LITERALLY: the latest stored period is authoritative
     * regardless. A period ending ahead of the business date — a month-to-date
     * window labelled to the month's end, or a delivery loaded early — is still
     * the one to read. Resolution must not filter by "not in the future",
     * because it has no clock to judge that against and should not acquire one.
     */
    const ahead: CatalogPeriod[] = [
      delivery("2026-09-30", { type: "mtd", start: "2026-09-01", label: "September 2026" }),
      delivery("2026-08-31", { type: "mtd", start: "2026-08-01", label: "August 2026" }),
    ];

    const resolved = resolvePeriod({ family: BED_USAGE, periods: ahead, intent: null });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.period.label).toBe("September 2026");

    // And freshness describes it honestly rather than overriding it.
    const freshness = familyFreshness({
      family: BED_USAGE,
      latest: ahead[0],
      today: "2026-09-09",
    });
    expect(freshness.asOf).toBe("2026-09-30");
    expect(freshness.level).toBe("current");
  });

  it("does not resolve a period from 'today' or 'yesterday' at all", () => {
    /*
     * The freshness layer exists precisely so these are not period selectors.
     * If either ever became one, Sunny could claim figures for a day no
     * delivery covers — which is the failure the whole timezone question is
     * downstream of.
     */
    expect(detectPeriodIntent("how are we doing today")).toBeNull();
    expect(detectPeriodIntent("what did we do yesterday")).toBeNull();
  });
});
