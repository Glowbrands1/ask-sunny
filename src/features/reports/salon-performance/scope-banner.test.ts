import { describe, expect, it } from "vitest";

import type { ReportScope } from "@/lib/reporting/read";
import { formatPeriodEnd, scopeSentence } from "./scope-banner";

/**
 * The scope sentence is approved wording that appears on every view, so it is
 * pinned by a test. If someone edits the copy, this fails and they have to mean
 * it.
 */

const SCOPE: ReportScope = {
  ingestionId: "ing-1",
  periodId: "period-1",
  grain: "mtd",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-30",
  periodLabel: "MTD 08/30/2026",
  fiscalYear: 2026,
  salonCount: 15,
  factCount: 562,
  metricCount: 16,
  ingestedAt: "2026-09-01T09:00:00Z",
  parserKey: "comp_sales_mtd_vs_2024",
  parserVersion: 1,
  companyWide: false,
};

describe("scopeSentence", () => {
  it("is exactly the approved wording for the verified baseline", () => {
    expect(scopeSentence(SCOPE)).toBe(
      "15 salons included in this report · MTD ending Aug 30, 2026 · Recipient slice — not company-wide",
    );
  });

  it("is driven by the data, not hard-coded", () => {
    // A different report must produce a different sentence.
    const other = scopeSentence({
      ...SCOPE,
      salonCount: 116,
      grain: "ytd",
      periodEnd: "2026-12-31",
    });
    expect(other).toBe(
      "116 salons included in this report · YTD ending Dec 31, 2026 · Recipient slice — not company-wide",
    );
  });

  it("keeps the recipient-slice caveat whatever the counts are", () => {
    for (const salonCount of [1, 15, 116, 999]) {
      expect(scopeSentence({ ...SCOPE, salonCount })).toContain(
        "Recipient slice — not company-wide",
      );
    }
  });

  it("reads naturally for a single salon", () => {
    expect(scopeSentence({ ...SCOPE, salonCount: 1 })).toContain(
      "1 salon included in this report",
    );
  });
});

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
