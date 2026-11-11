import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/runtime", () => ({ isDemoMode: () => true }));

import { PRODUCTION_SALONS } from "@/data/salons";
import { ReportingReadRepository } from "../read/reporting-read-repository";
import { loadReportContext } from "../read/report-context";
import { listBedUsagePeriods, loadBedUsage, loadSpaEngagement, listSpaEngagementPeriods } from "../read/bed-spa/read";
import { listSalesTotalsDates, loadSalesTotals } from "../read/sales-totals-read";
import { demoReportingClient } from "./client";
import { demoReportingTables, demoSalonNumbersForArea } from "./fixtures";

/**
 * DEMO BRANCH ONLY. The reporting pages read these invented rows through the
 * real read layer in demo mode; this checks the rows resolve end to end.
 */
describe("demo reporting fixtures", () => {
  it("names no district or region after a person", () => {
    const tables = demoReportingTables();
    const labels = new Set(
      tables.salon_period_attributes.flatMap((row) => [row.district_label, row.region_label]),
    );
    expect([...labels].sort()).toEqual(["District 1", "District 2", "District 3", "Region A", "Region B"]);
  });

  it("resolves Salon Performance on all fifteen demo salons", async () => {
    const repository = new ReportingReadRepository(demoReportingClient());
    const loaded = await loadReportContext({}, repository);
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(loaded.context.allSalons).toHaveLength(PRODUCTION_SALONS.length);
    expect(loaded.context.activeWindow.id).toBe("2025");
    expect(loaded.context.windows.map((window) => window.id)).toContain("last_3m");
  });

  it("narrows a district scope to that district's salons", async () => {
    const numbers = demoSalonNumbersForArea("dist-3");
    const repository = new ReportingReadRepository(demoReportingClient());
    const loaded = await loadReportContext({}, repository, {
      unrestricted: false,
      salonNumbers: numbers,
      areaLabel: "District 3",
      level: "district",
    });
    expect(loaded.status === "ready" && loaded.context.allSalons.length).toBe(numbers.length);
  });

  it("serves the other reports", async () => {
    const dates = await listSalesTotalsDates();
    expect(dates[0].reportDate).toBe("2026-11-10");
    const sales = await loadSalesTotals({ reportDate: dates[0].reportDate, window: "mtd" });
    expect(sales?.salons).toHaveLength(15);
    expect(sales?.summaries.map((summary) => summary.key)).toContain("all_salons");

    const bedPeriods = await listBedUsagePeriods();
    const beds = await loadBedUsage(bedPeriods[0].periodId);
    expect(beds?.salons).toHaveLength(15);

    const engagement = await loadSpaEngagement((await listSpaEngagementPeriods())[0].periodId);
    expect(engagement?.salons.every((salon) => salon.overallRank !== null)).toBe(true);
  });
});
