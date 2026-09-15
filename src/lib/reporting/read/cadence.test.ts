import { describe, expect, it } from "vitest";

import {
  CADENCE_LABEL,
  cadenceLabel,
  freshnessLine,
  type ReportCadence,
} from "./freshness-line";
import { REPORT_FAMILIES, REPORT_FAMILIES_BY_ID } from "./report-families";

/**
 * ============================================================================
 * THE REGRESSION THIS FILE EXISTS FOR
 * ============================================================================
 *
 * THE REVIEW: Salon Performance read "Updated monthly" while Comp Reports were
 * arriving several times a month. The production receipts for September settle
 * it — six Comp Report files ingested on five separate days (the 1st, 3rd,
 * 10th, 11th and 14th) — so the label was not merely imprecise, it was the
 * opposite of what a manager needed on the 11th: it said the figures in front
 * of them were a month old when they were a day old.
 *
 * The cause was a category error, not a typo. `cadence` was filled in from the
 * WINDOW the workbook covers (month-to-date, year-to-date) rather than the rate
 * it ARRIVES at, and nothing in the type could tell the two apart.
 *
 * WHAT MUST NOT COME BACK: Salon Performance declaring a fixed schedule it does
 * not have. And what must not be "fixed" along with it: the four families that
 * genuinely do have one.
 */

describe("Salon Performance states a trigger, not a schedule", () => {
  const family = REPORT_FAMILIES_BY_ID["salon-performance"];

  it("no longer claims a monthly schedule", () => {
    expect(family.cadence).not.toBe("monthly");
    expect(family.cadence).toBe("on_delivery");
  });

  it("does not claim a daily one either", () => {
    /*
     * Six deliveries on five days is not daily: two landed on one day and most
     * days had none. "Updated daily" would be the same mistake reversed, and
     * the review said so explicitly.
     */
    expect(family.cadence).not.toBe("daily");
    expect(family.cadence).not.toBe("weekly");
  });

  it("names the delivery a reader is actually waiting on", () => {
    expect(cadenceLabel(family.cadence, family.sourceReport)).toBe(
      "Updated as new Comp Reports are received",
    );
  });

  it("puts that sentence in the freshness line the page renders", () => {
    const line = freshnessLine({
      dataThrough: "2026-09-12",
      refreshedAt: "2026-09-14T11:00:00Z",
      salonCount: 15,
      cadence: family.cadence,
      sourceReport: family.sourceReport,
    });

    expect(line).toContain("Updated as new Comp Reports are received");
    expect(line).not.toContain("Updated monthly");
    // The other three facts are untouched by this change.
    expect(line).toContain("Data through September 12, 2026");
    expect(line).toContain("15 salons included");
  });
});

describe("the other families keep the schedules they really have", () => {
  it.each([
    ["sales-totals", "daily"],
    ["bed-usage", "monthly"],
    ["spa-wellness", "monthly"],
    ["spa-engagement", "monthly"],
  ] as const)("%s stays %s", (id, cadence) => {
    expect(REPORT_FAMILIES_BY_ID[id].cadence).toBe(cadence);
  });

  it("leaves the scheduled labels exactly as they were", () => {
    expect(CADENCE_LABEL.daily).toBe("Updated daily");
    expect(CADENCE_LABEL.weekly).toBe("Updated weekly");
    expect(CADENCE_LABEL.monthly).toBe("Updated monthly");
  });

  it("does not let a scheduled cadence be renamed by its source", () => {
    // "Updated daily" is already the whole truth; the file's name adds nothing.
    expect(cadenceLabel("daily", "daily Sales Totals email")).toBe("Updated daily");
    expect(cadenceLabel("monthly", "monthly Bed Usage Report")).toBe("Updated monthly");
  });
});

describe("the event-driven label is derived, not hard-coded", () => {
  it("takes the name from whatever family declares the cadence", () => {
    expect(cadenceLabel("on_delivery", "Widget Report")).toBe(
      "Updated as new Widget Reports are received",
    );
  });

  it("does not double a plural that is already there", () => {
    expect(cadenceLabel("on_delivery", "Sales Totals")).toBe(
      "Updated as new Sales Totals are received",
    );
  });

  it("falls back to a generic sentence when no source is supplied", () => {
    expect(cadenceLabel("on_delivery", null)).toBe(
      "Updated as new reports are received",
    );
    expect(cadenceLabel("on_delivery")).toBe(CADENCE_LABEL.on_delivery);
    expect(cadenceLabel("on_delivery", "   ")).toBe(CADENCE_LABEL.on_delivery);
  });
});

describe("every cadence a family can declare has a sentence", () => {
  it("covers the whole vocabulary", () => {
    const declared = new Set<ReportCadence>(
      REPORT_FAMILIES.map((family) => family.cadence),
    );
    for (const cadence of declared) {
      const label = cadenceLabel(cadence, "Some Report");
      expect(label.length).toBeGreaterThan(0);
      // A cadence segment that read "undefined" would ship silently otherwise.
      expect(label).not.toContain("undefined");
    }
  });
});
