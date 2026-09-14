import { describe, expect, it } from "vitest";

import { formatPeriodEnd } from "./scope-banner";

/**
 * `scopeSentence` AND ITS TESTS ARE GONE. It pinned the approved wording of a
 * banner nothing rendered any more, and two thirds of that wording is what the
 * 14 September review asked to be removed: "Recipient slice — not
 * company-wide". The facts it stated are pinned instead by
 * `lib/reporting/read/freshness-line.test.ts`, against the line that is
 * actually on all five tabs.
 *
 * `formatPeriodEnd` survives, and so do its tests: the filter bar labels its
 * period menu with it, and the day-shift guard below is the reason it is not
 * `new Date(...)` at the call site.
 */

describe("formatPeriodEnd", () => {
  it("formats the approved date shape", () => {
    expect(formatPeriodEnd("2026-08-30")).toBe("Aug 30, 2026");
  });

  it("does not shift the day in any host timezone", () => {
    // The period is a plain date; rendering it must not consult a local offset.
    const original = process.env.TZ;
    try {
      for (const zone of ["Pacific/Kiritimati", "Pacific/Midway", "UTC"]) {
        process.env.TZ = zone;
        expect(formatPeriodEnd("2026-01-01"), zone).toBe("Jan 1, 2026");
        expect(formatPeriodEnd("2026-12-31"), zone).toBe("Dec 31, 2026");
      }
    } finally {
      process.env.TZ = original;
    }
  });
});
