import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SYNC_CRON_EXPRESSION,
  SYNC_CRON_UTC_HOURS,
  SYNC_LOCAL_HOUR,
  SYNC_TIME_ZONE,
  localHourIn,
  localTimeIn,
  scheduleWindow,
} from "./schedule";

/**
 * ============================================================================
 * ONE RUN A DAY, AT SIX IN THE MORNING WHERE THE SALONS ARE
 * ============================================================================
 *
 * The claim this module makes is not "the cron expression looks right". It is
 * that over any stretch of years, INCLUDING the Sundays the clocks move,
 * exactly one of the two UTC ticks lands in the 06:00 hour in America/Chicago.
 *
 * That is a claim about seven years of calendar arithmetic and daylight saving
 * rules, so it is checked against seven years of calendar arithmetic and
 * daylight saving rules rather than argued about in a comment. A schedule that
 * quietly walks an hour every March is exactly the bug nobody finds until the
 * morning figures have been an hour late for a month.
 */

const DAY_MS = 86_400_000;

/** Every day from the start of `fromYear` to the end of `toYear`, at 00:00 UTC. */
function* days(fromYear: number, toYear: number): Generator<Date> {
  const end = Date.UTC(toYear + 1, 0, 1);
  for (let ms = Date.UTC(fromYear, 0, 1); ms < end; ms += DAY_MS) {
    yield new Date(ms);
  }
}

/** The moments the cron entry fires on the UTC day containing `day`. */
function ticksOn(day: Date): Date[] {
  return SYNC_CRON_UTC_HOURS.map(
    (hour) =>
      new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 0, 0),
      ),
  );
}

describe("the cron entry and the window agree", () => {
  it("IS THE SCHEDULE VERCEL ACTUALLY FIRES ON, so the two cannot drift apart", () => {
    const configPath = path.join(process.cwd(), "vercel.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      crons?: { path: string; schedule: string }[];
    };

    const crons = config.crons ?? [];

    /*
     * ONE ENTRY, NOT TWO. A second entry pointing at the same route would be a
     * second schedule spending money on the same reviews, and it is precisely
     * the mistake a hand-edited config invites.
     */
    expect(crons).toHaveLength(1);
    expect(crons[0].path).toBe("/api/reviews/apify/cron");
    expect(crons[0].schedule).toBe(SYNC_CRON_EXPRESSION);
  });

  it("fires twice a day in UTC, because one UTC hour cannot be 06:00 Central all year", () => {
    expect(SYNC_CRON_UTC_HOURS).toHaveLength(2);
    expect(SYNC_CRON_EXPRESSION).toBe("0 11,12 * * *");
  });
});

describe("the cron route actually consults the window", () => {
  /*
   * A SOURCE SCAN, because the claim is about ORDER and the route's own
   * dependencies are a Supabase client and Apify's API. What can go wrong here
   * is not the arithmetic — that is covered above — but somebody adding a
   * branch that reaches `startApifySync` before the hour has been checked, and
   * that is visible in the file.
   */
  const route = readFileSync(
    path.join(process.cwd(), "src/app/api/reviews/apify/cron/route.ts"),
    "utf8",
  );

  it("checks the hour BEFORE anything that can start a run", () => {
    const checksWindow = route.indexOf("scheduleWindow()");
    const startsRun = route.indexOf("startApifySync(");

    expect(checksWindow).toBeGreaterThan(-1);
    expect(startsRun).toBeGreaterThan(-1);
    expect(checksWindow).toBeLessThan(startsRun);
  });

  it("reconciles a lost webhook BEFORE it decides the tick is the wrong hour", () => {
    /*
     * The off-hour tick is the only other visit of the day, so settling a stuck
     * run has to happen above the gate — otherwise half the reconciliation
     * opportunities are thrown away for no gain.
     */
    expect(route.indexOf("reconcileStaleRuns()")).toBeLessThan(
      route.indexOf("scheduleWindow()"),
    );
  });

  it("answers the off-hour tick with a 200, not a broken cron", () => {
    const outside = route.indexOf('status: "outside_window"');
    expect(outside).toBeGreaterThan(-1);
    /* No `{ status: 4xx/5xx }` second argument on that response. */
    expect(route.slice(outside, outside + 400)).not.toMatch(/\{ status: \d{3} \}/);
  });
});

describe("exactly one tick a day is due", () => {
  it("NEVER ZERO AND NEVER TWO, across seven years of daylight saving", () => {
    const counts = new Map<number, number>();

    for (const day of days(2026, 2032)) {
      const due = ticksOn(day).filter((at) => scheduleWindow(at).status === "due");
      counts.set(due.length, (counts.get(due.length) ?? 0) + 1);

      for (const at of due) {
        /* And the one that IS due is six o'clock local, not merely the winner. */
        expect(localHourIn(SYNC_TIME_ZONE, at), at.toISOString()).toBe(SYNC_LOCAL_HOUR);
      }
    }

    expect([...counts.keys()]).toEqual([1]);
  });

  it("names the other tick outside_window rather than failing it", () => {
    for (const day of days(2026, 2028)) {
      const statuses = ticksOn(day).map((at) => scheduleWindow(at).status);
      expect(statuses.filter((status) => status === "due")).toHaveLength(1);
      expect(statuses.filter((status) => status === "outside_window")).toHaveLength(1);
    }
  });

  it("is right on the two Sundays the clocks move, which are the days worth naming", () => {
    /* 2027: spring forward Sun 14 March, fall back Sun 7 November. */
    const springForward = new Date("2027-03-14T00:00:00Z");
    const fallBack = new Date("2027-11-07T00:00:00Z");

    for (const day of [springForward, fallBack]) {
      const [eleven, twelve] = ticksOn(day);
      const due = [eleven, twelve].filter((at) => scheduleWindow(at).status === "due");
      expect(due, day.toISOString()).toHaveLength(1);
      expect(localHourIn(SYNC_TIME_ZONE, due[0])).toBe(SYNC_LOCAL_HOUR);
    }

    /* CDT is in force on the morning of the spring-forward day: 11:00 UTC wins. */
    expect(scheduleWindow(new Date("2027-03-14T11:00:00Z")).status).toBe("due");
    /* CST is in force by the morning of the fall-back day: 12:00 UTC wins. */
    expect(scheduleWindow(new Date("2027-11-07T12:00:00Z")).status).toBe("due");
  });
});

describe("reading a local hour", () => {
  it("answers in the salons' time and not the server's", () => {
    /* 2026-07-01 is CDT, UTC−5. */
    expect(localHourIn(SYNC_TIME_ZONE, new Date("2026-07-01T11:00:00Z"))).toBe(6);
    /* 2026-12-01 is CST, UTC−6. */
    expect(localHourIn(SYNC_TIME_ZONE, new Date("2026-12-01T11:00:00Z"))).toBe(5);
    expect(localHourIn(SYNC_TIME_ZONE, new Date("2026-12-01T12:00:00Z"))).toBe(6);
  });

  it("renders midnight as 0 rather than 24", () => {
    expect(localHourIn(SYNC_TIME_ZONE, new Date("2026-07-01T05:00:00Z"))).toBe(0);
  });

  it("REFUSES A ZONE IT CANNOT RESOLVE rather than quietly answering in UTC", () => {
    expect(localHourIn("Mars/Olympus_Mons", new Date())).toBeNull();
    expect(localTimeIn("Mars/Olympus_Mons", new Date())).toBeNull();
  });

  it("fails closed when the zone is unavailable, so no run starts at the wrong hour", () => {
    const original = Intl.DateTimeFormat;
    try {
      /* A runtime that answers every zone in UTC — the failure mode worth catching. */
      Object.defineProperty(Intl, "DateTimeFormat", {
        configurable: true,
        writable: true,
        value: function FakeDateTimeFormat(locale?: string, options?: Intl.DateTimeFormatOptions) {
          return new original(locale, { ...options, timeZone: "UTC" });
        },
      });

      expect(scheduleWindow(new Date("2026-07-01T11:00:00Z")).status).toBe(
        "timezone_unavailable",
      );
    } finally {
      Object.defineProperty(Intl, "DateTimeFormat", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });
});

describe("the local time it reports", () => {
  it("is readable, carries the zone, and is never a bare offset", () => {
    expect(localTimeIn(SYNC_TIME_ZONE, new Date("2026-07-01T11:00:00Z"))).toBe(
      "2026-07-01 06:00 America/Chicago",
    );
    expect(localTimeIn(SYNC_TIME_ZONE, new Date("2026-12-01T12:00:00Z"))).toBe(
      "2026-12-01 06:00 America/Chicago",
    );
  });

  it("rides along on the window so a tick can say what time it thought it was", () => {
    const window = scheduleWindow(new Date("2026-07-01T12:00:00Z"));
    expect(window.status).toBe("outside_window");
    expect(window.status !== "timezone_unavailable" && window.localTime).toBe(
      "2026-07-01 07:00 America/Chicago",
    );
  });
});
