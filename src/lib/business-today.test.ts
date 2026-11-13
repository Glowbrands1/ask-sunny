import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { recordToday } from "./business-today";

/*
 * Live bug (QA, 13 Nov 2026; Pau's audit: 27 of 29 evening forms in the last 30 days, 6 of them finalized): "Sunny
 * puts tomorrow's date on evening forms." instances.ts defaulted form_date/date to new Date().toISOString().slice(0, 10),
 * the UTC date, which is already the next day from about 6–7 PM Central.
 *
 * QA's example was 2026-11-12T23:30:00Z, which is still 12 Nov in UTC; the instant below is 7:30 PM Central / 8:30 PM
 * Eastern on 12 Nov, when UTC already says 13 Nov.
 */
const EVENING = new Date("2026-11-13T01:30:00Z");

afterEach(() => vi.unstubAllEnvs());

describe("FORM_DATE_BUSINESS_TODAY: an evening form is dated today, not tomorrow", () => {
  it("flag off: the UTC date, as before (the bug)", () => {
    expect(recordToday(EVENING)).toBe("2026-11-13");
  });

  it("flag on: the business date", () => {
    vi.stubEnv("FORM_DATE_BUSINESS_TODAY_ENABLED", "true");
    expect(recordToday(EVENING)).toBe("2026-11-12");
  });

  it("flag on: daytime is the same date either way", () => {
    vi.stubEnv("FORM_DATE_BUSINESS_TODAY_ENABLED", "true");
    expect(recordToday(new Date("2026-11-12T18:00:00Z"))).toBe("2026-11-12");
  });

  it("every 'today' used as a business date reads recordToday, not the UTC slice", () => {
    for (const file of [
      "src/lib/forms/instances.ts",
      "src/app/api/forms/templates/[key]/preview/route.ts",
      "src/lib/employees/woven/sync.ts",
      "src/lib/employees/woven/validate.ts",
      "src/lib/employees/woven/access/new-hire.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("recordToday(");
      expect(source, file).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)|now\(\)\.toISOString\(\)\.slice\(0, 10\)|now\.toISOString\(\)\.slice\(0, 10\)/);
    }
  });
});
