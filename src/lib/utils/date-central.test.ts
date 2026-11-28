import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatDate, formatDateTime, formatLongDate, formatTime } from "./date";

/**
 * CENTRAL TIME FOR EVERY MOMENT A PERSON SEES (owner, 28 Nov 2026: "timezone is in CT for all").
 *
 * These read the UTC parts, so Form Monitoring's "done" column showed a follow-up marked done at 7 PM Central on
 * Nov 28 as "Nov 29", and a knowledge upload showed the UTC clock with no zone. A calendar date (a form's date, a
 * follow-up date, an analytics day bucket) is not a moment and never shifts.
 */
describe("dates people see are in Central", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_BUSINESS_TIMEZONE", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("a moment in the Central evening shows the Central day, not the UTC day", () => {
    // 7:15 PM CST on Nov 28 is 01:15 UTC on Nov 29.
    expect(formatDate("2026-11-29T01:15:00Z")).toBe("Nov 28, 2026");
    expect(formatLongDate("2026-11-29T01:15:00.000Z")).toBe("November 28, 2026");
  });

  it("a moment's clock is Central and says so", () => {
    expect(formatDateTime("2026-11-29T01:15:00Z")).toBe("Nov 28, 2026 · 7:15 PM CT");
    expect(formatTime("2026-11-29T01:15:00Z")).toBe("7:15 PM");
    // Daylight time: 18:04 UTC on 1 Jul is 1:04 PM CDT, still labelled CT.
    expect(formatDateTime("2026-07-01T18:04:00Z")).toBe("Jul 1, 2026 · 1:04 PM CT");
  });

  it("a calendar date never shifts", () => {
    expect(formatDate("2026-11-28")).toBe("Nov 28, 2026");
    expect(formatLongDate("2026-11-28")).toBe("November 28, 2026");
    // A day bucket from date_trunc arrives as UTC midnight: the day it names.
    expect(formatDate("2026-11-01T00:00:00+00:00")).toBe("Nov 1, 2026");
  });

  it("nothing is a dash", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });
});
