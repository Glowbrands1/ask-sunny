import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BUSINESS_TIMEZONE, businessWeekEnd } from "@/lib/business-date";
import {
  currentWeekStart,
  formatWeekRange,
  monthStart,
  recentWeekStarts,
  weekEndOf,
  weekStartOf,
} from "./reporting-week";

/**
 * THE REPORTING WEEK IS DECLARED TWICE — here and in
 * `public.google_review_week_start()` — and the two must agree about the
 * timezone or a Saturday-evening review lands in a different week on the
 * dashboard than in the database. That is an off-by-one nobody finds for a
 * month, and it would be found by somebody re-counting a week by hand and
 * getting a different answer.
 *
 * So the migration is read AS TEXT and the zone is compared, the same way the
 * activity taxonomy is kept in step with its enums.
 */

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260917002000_google_reviews.sql",
  ),
  "utf8",
);

describe("the SQL and TypeScript halves agree", () => {
  it("uses the same business timezone in both", () => {
    const declared = /p_zone text default '([^']+)'/.exec(migration)?.[1];
    expect(declared).toBe(BUSINESS_TIMEZONE);
  });

  it("computes the Sunday the same way the SQL does", () => {
    /*
     * The SQL is `date - extract(dow from date)`, where dow is 0 for Sunday.
     * This is the same subtraction, and the cases below are the boundaries
     * where an off-by-one would show: a Sunday, and the Saturday before it.
     */
    expect(weekStartOf("2026-09-13")).toBe("2026-09-13"); // a Sunday
    expect(weekStartOf("2026-09-17")).toBe("2026-09-13"); // the Thursday after
    expect(weekStartOf("2026-09-19")).toBe("2026-09-13"); // the Saturday after
    expect(weekStartOf("2026-09-20")).toBe("2026-09-20"); // the next Sunday
  });
});

describe("the week itself", () => {
  it("runs Sunday to Saturday, matching the app's existing business week", () => {
    const start = weekStartOf("2026-09-17");
    expect(weekEndOf(start)).toBe("2026-09-19");
    /* The same week `businessWeekEnd` already draws for follow-ups. */
    expect(businessWeekEnd("2026-09-17")).toBe(weekEndOf(start));
  });

  it("resolves the current week from a business date", () => {
    expect(currentWeekStart("2026-09-17")).toBe("2026-09-13");
  });

  it("lists recent weeks oldest first, ending with the current one", () => {
    const weeks = recentWeekStarts(4, "2026-09-17");
    expect(weeks).toEqual(["2026-08-23", "2026-08-30", "2026-09-06", "2026-09-13"]);
  });

  it("crosses a month and a year boundary without drifting", () => {
    expect(weekStartOf("2026-03-03")).toBe("2026-03-01");
    expect(weekStartOf("2027-01-01")).toBe("2026-12-27");
    expect(recentWeekStarts(2, "2027-01-01")).toEqual(["2026-12-20", "2026-12-27"]);
  });

  it("gives the first of the month for month-to-date", () => {
    expect(monthStart("2026-09-17")).toBe("2026-09-01");
    expect(monthStart("2026-01-31")).toBe("2026-01-01");
  });

  it("prints a week as a range a person can read off a chart", () => {
    /*
     * FORMATTED AS A LABEL, NOT AS AN INSTANT. The date was already decided in
     * the business zone; re-interpreting it westward would print the 12th, and
     * the chart's axis would disagree with the tile above it by one day.
     */
    expect(formatWeekRange("2026-09-13")).toBe("Sep 13 – Sep 19");
  });
});
