import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import type { ManualChunk } from "./official-policy-manual";

/**
 * WORK_AREA_ABSENCE_CITES_CONDUCT_ENABLED (Pau's decision, 9 Nov 2026, via QA, for both apps; the people invented):
 * "leaving the front desk unattended" cites the Standards of Conduct, by the page the manual prints for its line
 * "Unauthorized absence from the work area during the workday", never Attendance, and only that section, whatever else
 * the account says (Pau, the same day: not the Meal and Rest Policy, even when the building was left). Read against the
 * production JBA manual rows (printed pages; the PDF sheet is printed + 1): the line is on printed page 13. The replay
 * pack covers the route (`nov9-work-area-absence-cites-conduct-cases.ts`).
 */
const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);
const cited = (text: string) => accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`);
const CONDUCT = "Standards of Conduct p.13";

beforeEach(() => {
  vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "true");
  vi.stubEnv("WORK_AREA_ABSENCE_CITES_CONDUCT_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("WORK_AREA_ABSENCE_CITES_CONDUCT_ENABLED", "true");

describe("WORK_AREA_ABSENCE_CITES_CONDUCT_ENABLED", () => {
  it("off: \"left the front desk unattended\" cites no section of its own (the card fell to the model's Attendance)", () => {
    expect(cited("create a ca for Mave Thistlewood, she left the front desk unattended on 11/6/26")).toEqual([]);
  });

  it.each([
    "create a ca for Mave Thistlewood, she left the front desk unattended on 11/6/26",
    "make it about leaving the front desk unattended on 11/6/26",
    "she left the register unattended during her shift",
    "she walked away from the counter and left it unattended",
    "the front desk was left unattended for 20 minutes",
    "she left the floor during her shift",
  ])("on: %s → the Standards of Conduct line's page", (said) => {
    on();
    expect(cited(said)).toEqual([CONDUCT]);
  });

  it.each([
    "create a ca for Mave Thistlewood, she left the front desk unattended and went to her car",
    "she left the front desk unattended and left the building",
    "she left the register unattended with no one else in the salon",
  ])("on: %s → the Standards of Conduct only (Pau, 9 Nov 2026: never the Meal and Rest Policy)", (said) => {
    on();
    expect(cited(said)).toEqual([CONDUCT]);
  });

  it.each([
    "create a ca for Mave Thistlewood, she was late to her shift on 11/6/26",
    "create a ca for Mave Thistlewood, she was a no call no show on 11/6/26",
    "she left the floor dirty at close",
    "she did not leave the front desk unattended",
  ])("on: %s → as before", (said) => {
    const before = cited(said);
    on();
    expect(cited(said)).toEqual(before);
  });
});
