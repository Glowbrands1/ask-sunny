import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUSINESS_TIMEZONE, businessToday } from "@/lib/business-date";
import { GOOGLE_REVIEWS_TIMEZONE, googleReviewsToday } from "./timezone";

/**
 * THE FEATURE'S OWN ZONE, AND THE PROMISE THAT IT STAYS ITS OWN.
 *
 * Google Reviews moved to Central because its weekly count is reconciled by
 * hand against Google's console by people working Central. Nothing else moved,
 * and these tests exist so that stays true in both directions: the reviews zone
 * must not drift back to Eastern, and the app-wide zone must not be dragged to
 * Central by somebody "tidying up" the pair.
 */

describe("the zone", () => {
  it("is Central, through the IANA zone so CST/CDT is automatic", () => {
    expect(GOOGLE_REVIEWS_TIMEZONE).toBe("America/Chicago");
  });

  it("is not the app-wide business zone, and does not disturb it", () => {
    /*
     * THE SCOPE OF THE CHANGE IN ONE ASSERTION. Follow-up due dates and the
     * Overview greeting are still judged in Eastern.
     */
    expect(BUSINESS_TIMEZONE).toBe("America/New_York");
    expect(GOOGLE_REVIEWS_TIMEZONE).not.toBe(BUSINESS_TIMEZONE);
  });

  it("is a constant, not a deployment setting", () => {
    /*
     * `BUSINESS_TIMEZONE` reads `NEXT_PUBLIC_BUSINESS_TIMEZONE` because the app
     * is deployed for different operators. This one must not, because a
     * deployment that quietly changed it would move reviews between weeks with
     * nothing in the code to say so.
     */
    const text = readFileSync(
      join(process.cwd(), "src", "lib", "reviews", "timezone.ts"),
      "utf8",
    );
    const declaration = /export const GOOGLE_REVIEWS_TIMEZONE =([^;]+);/.exec(text)?.[1];
    expect(declaration?.trim()).toBe('"America/Chicago"');
  });
});

describe("today, in the reviews zone", () => {
  it("reads an instant as the Central calendar day it fell on", () => {
    expect(googleReviewsToday(new Date("2026-09-21T14:10:00Z"))).toBe("2026-09-21");
  });

  it("is still the previous day when UTC has already rolled over", () => {
    /* 02:30Z is 9:30 the previous evening in Central. */
    expect(googleReviewsToday(new Date("2026-09-21T02:30:00Z"))).toBe("2026-09-20");
  });

  it("differs from the app-wide business date inside the boundary hour", () => {
    /*
     * 04:30Z is Sunday 00:30 Eastern and Saturday 23:30 Central. The two
     * helpers are SUPPOSED to disagree here — that disagreement is the change.
     */
    const instant = new Date("2026-09-20T04:30:00Z");
    expect(googleReviewsToday(instant)).toBe("2026-09-19");
    expect(businessToday(instant)).toBe("2026-09-20");
  });

  it("agrees with the app-wide business date the rest of the time", () => {
    for (const iso of ["2026-09-21T14:10:00Z", "2026-01-15T18:00:00Z"]) {
      const instant = new Date(iso);
      expect(googleReviewsToday(instant)).toBe(businessToday(instant));
    }
  });

  it("gives the same answer whatever zone the host process is in", () => {
    /*
     * The server renders these pages, and the server is a UTC container. A
     * helper that read the host's zone would put the dashboard in a different
     * week from a developer's laptop.
     */
    const before = process.env.TZ;
    try {
      for (const hostZone of ["UTC", "America/Chicago", "Asia/Tokyo"]) {
        process.env.TZ = hostZone;
        expect(googleReviewsToday(new Date("2026-09-20T04:30:00Z"))).toBe("2026-09-19");
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("follows daylight saving rather than a fixed offset", () => {
    /* 05:30Z is 11:30 p.m. Saturday in CST but 12:30 a.m. Sunday in CDT. */
    expect(googleReviewsToday(new Date("2026-01-18T05:30:00Z"))).toBe("2026-01-17");
    expect(googleReviewsToday(new Date("2026-07-19T05:30:00Z"))).toBe("2026-07-19");
  });
});
