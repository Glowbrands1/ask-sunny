import { readFileSync, readdirSync } from "node:fs";
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
import { GOOGLE_REVIEWS_TIMEZONE, googleReviewsToday } from "./timezone";

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
 *
 * THE LAST DECLARATION WINS, and it is found rather than named. The zone has
 * been changed once already (Eastern -> Central, in
 * `20260921001000_google_review_week_central.sql`) and pinning this test to one
 * filename would have quietly gone on asserting the superseded definition. The
 * migrations are applied in filename order, so the final `p_zone` default in
 * that order is the one the database actually ends up with.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** Every `p_zone` default declared for the week helper, in apply order. */
function declaredZones(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) => {
      const sql = readFileSync(join(MIGRATIONS, name), "utf8");
      return [...sql.matchAll(/p_zone text default '([^']+)'/g)].map((m) => m[1]);
    });
}

describe("the SQL and TypeScript halves agree", () => {
  it("assigns the week in the same zone in both", () => {
    const zones = declaredZones();
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.at(-1)).toBe(GOOGLE_REVIEWS_TIMEZONE);
  });

  it("assigns the week in Central, which is NOT the app-wide business zone", () => {
    /*
     * THE WHOLE POINT OF THE SPLIT. Google Reviews is reconciled against
     * Google's console by people working Central; follow-up due dates and the
     * Overview greeting stay on the app-wide Eastern default. If these two ever
     * become the same value again it should be a decision, not a drift.
     */
    expect(GOOGLE_REVIEWS_TIMEZONE).toBe("America/Chicago");
    expect(BUSINESS_TIMEZONE).toBe("America/New_York");
    expect(GOOGLE_REVIEWS_TIMEZONE).not.toBe(BUSINESS_TIMEZONE);
  });

  it("left the superseded Eastern declaration in its own migration untouched", () => {
    /*
     * A migration is a historical record. The original file must still say
     * Eastern — rewriting it would make the history claim the database was
     * always Central, and any deployment replaying from scratch would then have
     * no record of the change at all.
     */
    const zones = declaredZones();
    expect(zones[0]).toBe("America/New_York");
    expect(zones.length).toBeGreaterThanOrEqual(2);
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

/* ======================================================================== */

/**
 * THE ONE-HOUR WINDOW WHERE THE ZONES DISAGREE.
 *
 * Central is an hour behind Eastern all year, so for sixty minutes every
 * Saturday night — 23:00 to 23:59 Central — it is already Sunday in Eastern.
 * A review first seen in that window is the ONLY case where the choice of zone
 * moves it between reporting weeks, and it is the case the manual re-count
 * would expose: the person closing Saturday's numbers counts it, and a
 * dashboard reading Eastern does not.
 *
 * Every case below is written as a UTC instant — what the database actually
 * stores — and asserted through the same path production uses: the instant
 * becomes a Central calendar date, and the date becomes a Sunday.
 */

/** The week a stored instant is assigned to, through the production path. */
function weekOf(instant: string): string {
  return weekStartOf(googleReviewsToday(new Date(instant)));
}

/** What the SAME instant would have been assigned to under the old zone. */
function easternWeekOf(instant: string): string {
  const eastern = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
  return weekStartOf(eastern);
}

describe("the Saturday-night boundary", () => {
  it("counts 11:30 p.m. Saturday Central into the week that is closing", () => {
    /*
     * 2026-09-20T04:30:00Z is Saturday the 19th at 11:30 p.m. Central — and
     * Sunday the 20th at 12:30 a.m. Eastern. Central keeps it in the week that
     * opened on the 13th, which is the week the person counting is closing.
     */
    expect(weekOf("2026-09-20T04:30:00Z")).toBe("2026-09-13");
    expect(easternWeekOf("2026-09-20T04:30:00Z")).toBe("2026-09-20");
  });

  it("disagrees with Eastern across the whole 11:00-11:59 p.m. window", () => {
    /* Every minute of it, not just the one that happened to be picked. */
    for (const minute of ["00", "01", "30", "58", "59"]) {
      const instant = `2026-09-20T04:${minute}:00Z`;
      expect(weekOf(instant)).toBe("2026-09-13");
      expect(easternWeekOf(instant)).toBe("2026-09-20");
      expect(weekOf(instant)).not.toBe(easternWeekOf(instant));
    }
  });

  it("agrees with Eastern on the minute before the window opens", () => {
    /* 10:59 p.m. Central is 11:59 p.m. Eastern — still Saturday in both. */
    expect(weekOf("2026-09-20T03:59:00Z")).toBe("2026-09-13");
    expect(easternWeekOf("2026-09-20T03:59:00Z")).toBe("2026-09-13");
  });

  it("agrees with Eastern on the minute after the window closes", () => {
    /* Midnight Central is 1 a.m. Eastern — Sunday in both, the new week. */
    expect(weekOf("2026-09-20T05:00:00Z")).toBe("2026-09-20");
    expect(easternWeekOf("2026-09-20T05:00:00Z")).toBe("2026-09-20");
  });

  it("holds in winter, when Central is UTC-6 rather than UTC-5", () => {
    /*
     * THE REASON THE ZONE IS `America/Chicago` AND NOT A FIXED OFFSET. In
     * January the same 11:30 p.m. Saturday is 05:30Z, not 04:30Z. A hard-coded
     * -5 would read this as 12:30 a.m. Sunday and file it a week late.
     */
    expect(weekOf("2026-01-18T05:30:00Z")).toBe("2026-01-11");
    expect(easternWeekOf("2026-01-18T05:30:00Z")).toBe("2026-01-18");
  });

  it("holds across the autumn daylight-saving transition", () => {
    /* 2026-10-31 23:30 CDT, the Saturday before the clocks go back. */
    expect(weekOf("2026-11-01T04:30:00Z")).toBe("2026-10-25");
    expect(easternWeekOf("2026-11-01T04:30:00Z")).toBe("2026-11-01");
  });

  it("never files a plain weekday review differently from Eastern", () => {
    /*
     * The window is an hour a week. A sync running mid-morning — which is when
     * this one runs — is nowhere near it, and must be unaffected.
     */
    for (const instant of [
      "2026-09-21T11:01:20Z", // a real 6:01 a.m. Central sync
      "2026-09-21T12:25:37Z", // the 7:25 a.m. Central sync in the report
      "2026-09-23T18:00:00Z", // a Wednesday afternoon
    ]) {
      expect(weekOf(instant)).toBe(easternWeekOf(instant));
    }
  });
});

describe("the week the dashboard is currently showing", () => {
  it("opens Sunday 20 September and closes Saturday 26 September 2026", () => {
    /*
     * THE WEEK ON THE SCREEN MUST NOT MOVE. The chip read "Week of Sep 20 –
     * Sep 26" before the zone changed and has to read the same after it; this
     * change is about where FUTURE boundary reviews land, not about re-cutting
     * the week somebody is looking at.
     */
    const today = googleReviewsToday(new Date("2026-09-21T14:10:00Z"));
    expect(today).toBe("2026-09-21");

    const start = currentWeekStart(today);
    expect(start).toBe("2026-09-20");
    expect(weekEndOf(start)).toBe("2026-09-26");
    expect(formatWeekRange(start)).toBe("Sep 20 – Sep 26");
  });

  it("is the same week under Eastern, so the change moves nothing on screen", () => {
    expect(weekOf("2026-09-21T14:10:00Z")).toBe("2026-09-20");
    expect(easternWeekOf("2026-09-21T14:10:00Z")).toBe("2026-09-20");
  });

  it("still opens on the 20th late on the preceding Saturday evening", () => {
    /* 9 p.m. Central Saturday: the week that is closing, not the next one. */
    expect(weekOf("2026-09-20T02:00:00Z")).toBe("2026-09-13");
    /* And an hour into Sunday Central: the week the dashboard shows. */
    expect(weekOf("2026-09-20T06:00:00Z")).toBe("2026-09-20");
  });
});
