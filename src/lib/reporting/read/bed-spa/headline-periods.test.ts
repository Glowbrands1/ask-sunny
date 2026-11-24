import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { spaHeadlinePeriods } from "./headline-periods";
import type { BedSpaPeriod } from "./types";

/*
 * QA, 24 Nov 2026 (Ask Sunny, live): "Spa Engagement mixes periods. The headline Spa Conversion Rate card uses
 * newestSharedPeriod … e.g. August. The Spa Sessions and Unique % cards next to it use the page's own period … e.g.
 * through Sep 17. The page reads as one period, but QA saw "3,504 sessions through Sep 17" beside August conversion
 * figures."
 */
const SEPT_17: BedSpaPeriod = { grain: "mtd", periodStart: "2026-09-01", periodEnd: "2026-09-17", labelRaw: "9/1 - 9/17" };
const AUGUST: BedSpaPeriod = { grain: "mtd", periodStart: "2026-08-01", periodEnd: "2026-08-31", labelRaw: "8/1 - 8/31" };

describe("QA 24 Nov: one Spa Engagement card row never mixes windows silently", () => {
  it('QA saw "3,504 sessions through Sep 17" beside August conversion: each card names its period, and the row says it holds two', () => {
    const periods = spaHeadlinePeriods(SEPT_17, AUGUST);
    expect(periods.engagement).toBe("MTD · Sep 1–17, 2026");
    expect(periods.conversion).toBe("MTD · Aug 2026");
    expect(periods.mixed).toBe(true);
    expect(periods.notice).toBe(
      "These cards cover two periods. Spa Conversion Rate is for MTD · Aug 2026, the newest period Bed Usage and Spa Wellness both cover. Spa Sessions, Unique Spa Tanner % and Spa Per Unique % are for MTD · Sep 1–17, 2026, this report's period.",
    );
  });

  it("one period: no notice, and the cards share the same label", () => {
    const periods = spaHeadlinePeriods(AUGUST, AUGUST);
    expect(periods).toMatchObject({ mixed: false, notice: null });
    expect(periods.conversion).toBe(periods.engagement);
  });

  it("no shared period: conversion has none (its card gives the reason), and nothing is called mixed", () => {
    expect(spaHeadlinePeriods(SEPT_17, null)).toMatchObject({ conversion: null, mixed: false, notice: null });
  });

  it("the page puts a period on every headline card and the notice over the row", () => {
    const page = readFileSync("src/app/(app)/reports/spa-engagement/page.tsx", "utf8");
    expect(page).toMatch(/spaHeadlinePeriods\(data\.period, bedData\?\.period \?\? null\)/);
    expect(page.match(/period: headline\.(?:engagement|conversion)/g)?.length).toBe(4);
    expect(page).toContain("{headline.notice}");
  });
});
