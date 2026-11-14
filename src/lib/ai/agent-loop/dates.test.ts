import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { monthDayToIso } = await import("./tools");

/* Batch E (E13, Pau's review via QA): a month/day is read against the salon's local date, never the server's UTC clock. */
describe("a month/day as the card's date", () => {
  it("is this year's when it is not after today", () => {
    expect(monthDayToIso("11/4", "2026-11-14")).toBe("2026-11-04");
    expect(monthDayToIso("11/14", "2026-11-14")).toBe("2026-11-14");
  });
  it("is last year's when it is later in the year than today", () => {
    expect(monthDayToIso("12/20", "2026-11-14")).toBe("2025-12-20");
  });
  it("on a Central evening when UTC is already tomorrow, tomorrow's month/day is last year's, never this year's", () => {
    vi.setSystemTime(new Date("2026-11-15T04:30:00Z")); // the evening of 11/14 in the salon's time zone; UTC is 11/15
    expect(monthDayToIso("11/15", "2026-11-14")).toBe("2025-11-15");
    vi.useRealTimers();
  });
});
