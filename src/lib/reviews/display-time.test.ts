import { describe, expect, it } from "vitest";

import { REPORTING_TIME_ZONE } from "@/lib/reporting/read/freshness-line";
import {
  REVIEWS_DISPLAY_TIME_ZONE,
  formatReviewsDay,
  formatReviewsInstant,
} from "./display-time";

/**
 * THE BUG THIS FILE EXISTS TO KEEP FIXED.
 *
 * The dashboard chip read "Last sync 9/21/2026, 12:25:37 PM" while it was 9:10
 * in the morning Central — a sync from the future. The stored instant was
 * right; `toLocaleString()` with no `timeZone` rendered it in the host's zone,
 * and the host is a UTC container.
 *
 * `process.env.TZ` is set per case rather than assumed, because a test that
 * passes only on a UTC runner would not have caught the original defect: the
 * author's laptop was in Central and the chip looked correct there.
 */

function inHostZone(zone: string, run: () => void): void {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    run();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe("the zone itself", () => {
  it("is Central, through the IANA zone rather than an offset", () => {
    expect(REVIEWS_DISPLAY_TIME_ZONE).toBe("America/Chicago");
  });

  it("is the SAME constant the rest of the product renders timestamps in", () => {
    /*
     * A second Central-time constant is how two screens in one product start
     * disagreeing about what time it is, each internally consistent.
     */
    expect(REVIEWS_DISPLAY_TIME_ZONE).toBe(REPORTING_TIME_ZONE);
  });
});

describe("an instant rendered for a person", () => {
  it("draws the reported UTC stamp as the Central time it actually was", () => {
    /* The exact value the broken chip was reading. */
    expect(formatReviewsInstant("2026-09-21T12:25:37+00:00")).toBe(
      "9/21/2026, 7:25:37 AM CDT",
    );
  });

  it("is identical whatever zone the host process is in", () => {
    /*
     * THE REGRESSION ITSELF. The old code returned a different string per host,
     * so the same deployment read one way on a laptop and another on Vercel.
     */
    const expected = "9/21/2026, 7:25:37 AM CDT";
    for (const hostZone of ["UTC", "America/Chicago", "America/New_York", "Asia/Tokyo"]) {
      inHostZone(hostZone, () => {
        expect(formatReviewsInstant("2026-09-21T12:25:37Z")).toBe(expected);
      });
    }
  });

  it("never renders a morning sync as an afternoon one", () => {
    /*
     * The complaint in one assertion: at 12:25 UTC it is still morning in the
     * salons, and the chip must not say PM.
     */
    expect(formatReviewsInstant("2026-09-21T12:25:37Z")).toContain("AM");
  });

  it("follows the daylight saving transition instead of subtracting five hours", () => {
    /* September is CDT (UTC-5); January is CST (UTC-6). */
    expect(formatReviewsInstant("2026-09-21T12:25:37Z")).toBe("9/21/2026, 7:25:37 AM CDT");
    expect(formatReviewsInstant("2026-01-15T12:25:37Z")).toBe("1/15/2026, 6:25:37 AM CST");
  });

  it("reads an offset-bearing stamp and a Z stamp as the same instant", () => {
    /* PostgREST returns `+00:00`; fixtures and tests tend to write `Z`. */
    expect(formatReviewsInstant("2026-09-21T12:25:37+00:00")).toBe(
      formatReviewsInstant("2026-09-21T12:25:37Z"),
    );
  });

  it("names the zone, so a reader never has to guess which clock it is", () => {
    expect(formatReviewsInstant("2026-09-21T12:25:37Z")).toMatch(/\bC[DS]T$/);
  });

  it("gives null for nothing, rather than a placeholder or an invalid date", () => {
    expect(formatReviewsInstant(null)).toBeNull();
    expect(formatReviewsInstant(undefined)).toBeNull();
    expect(formatReviewsInstant("")).toBeNull();
    expect(formatReviewsInstant("not a timestamp")).toBeNull();
  });

  it("reports a future stamp as future rather than correcting it", () => {
    /*
     * NOT CLAMPED AND NOT `Date.now()`. If the stored instant is genuinely
     * ahead of the clock, that is a fact about the sync worth seeing.
     */
    expect(formatReviewsInstant("2030-01-01T00:00:00Z")).toBe(
      "12/31/2029, 6:00:00 PM CST",
    );
  });
});

describe("an instant reduced to a day", () => {
  it("uses the Central calendar day, not the UTC one", () => {
    /* 01:30 UTC is still the previous evening in Central. */
    expect(formatReviewsDay("2026-09-21T01:30:00Z")).toBe("9/20/2026");
  });

  it("gives null for nothing", () => {
    expect(formatReviewsDay(null)).toBeNull();
    expect(formatReviewsDay("not a timestamp")).toBeNull();
  });
});
