import { describe, expect, it } from "vitest";

import { MONITORING_MAX_ROWS, nextShowCount, parseShowCount } from "./monitoring-page-size";

describe("Form Monitoring page size", () => {
  it("loads one page of 200 by default or for anything unreadable", () => {
    expect(parseShowCount(undefined)).toBe(200);
    expect(parseShowCount("")).toBe(200);
    expect(parseShowCount("abc")).toBe(200);
    expect(parseShowCount("-5")).toBe(200);
    expect(parseShowCount("150")).toBe(200);
  });

  it("rounds up to whole pages and caps the read", () => {
    expect(parseShowCount("400")).toBe(400);
    expect(parseShowCount("401")).toBe(600);
    expect(parseShowCount("999999")).toBe(MONITORING_MAX_ROWS);
  });

  it("adds a page until the cap", () => {
    expect(nextShowCount(200)).toBe(400);
    expect(nextShowCount(MONITORING_MAX_ROWS)).toBeNull();
  });
});
