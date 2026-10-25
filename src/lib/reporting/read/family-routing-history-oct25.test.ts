import { describe, expect, it } from "vitest";

import { routeReportFamilies } from "./family-routing";

/**
 * ============================================================================
 * QA, ASK SUNNY FULL CHAT HISTORY (25 OCT 2026) — LAST YEAR'S FIGURES
 * ============================================================================
 *
 * conv_mv5u8m282je9f8w, the manager's turns word for word. The first reached
 * Sales Totals only — current day and month to date, no prior year — and the
 * answer said last year's figures were not ingested; the second turn found
 * them in the Comp Report (Salon Performance), which carries the 2025 basis.
 * Both turns must reach Salon Performance.
 *
 * conv_mvjtjxu32hy15y1 ("how many eft sales we had in october, nov, dec 2025
 * for all stores") already reaches both families; the answer that Nov and Dec
 * 2025 are not held was true (report_periods holds 2026 windows only, with a
 * 2025 basis for the same window, and EFT is revenue, not a count).
 */
describe("conv_mv5u8m282je9f8w: a prior-year comparison reaches the Comp Report", () => {
  it.each([
    "144th center revenue compared to last years",
    "compare that to last years",
    "how is revenue vs last year's",
    "revenue year over year",
  ])("%s", (question) => {
    expect(routeReportFamilies(question)).toContain("salon-performance");
  });

  it("conv_mvjtjxu32hy15y1: the EFT question reaches both reports", () => {
    expect(routeReportFamilies("tell me how many eft sales we had in october, nov, dec 2025 for all stores")).toEqual(
      expect.arrayContaining(["sales-totals", "salon-performance"]),
    );
  });
});
