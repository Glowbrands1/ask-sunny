import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import manual151 from "@/test/fixtures/jba-manual-production-151.json";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { flaggedCitationWrite } from "./policy-citation-fields";

/*
 * QA's production-flags bisect, 5 Nov 2026 (#3): with POLICY_CITATION_ENABLED on in production,
 * "did not complete daily cleaning duties" moved to Other still had Direct policy filled with the
 * Standards of Conduct (flaggedCitationWrite reads the lines the notes point at). The fill follows
 * the ticked box (behind CA_SALES_POLICY_ENABLED). The production manual, 151 chunks; the person invented.
 */
const chunks = (manual151.chunks as ChunkRow[]).map(manualChunkFromRow);
const CLEANING = "Write me a CA for Isolde Brannock for failing to complete opening duties. Isolde did not complete daily cleaning duties. on november 2, 2026";
/* Upkeep that is not cleaning (the cleaning reader does not read it): the drafting model's "upkeep_or_task" basis moves the tick to Other, and the notes still suggest the Standards of Conduct. */
const PROCEDURE = "make a corrective action for Wynne Sarrow, the restocking duties were not completed before close on 11/2";
const MANUAL = { documentId: "d", documentTitle: "JBA Policy Manual", matchedBy: "title" as const };
const write = (ticked?: string[], notes = PROCEDURE) =>
  flaggedCitationWrite({ enabled: true, templateKey: "dpoa", values: {}, notes, chunks, manual: MANUAL as never, ticked });

beforeEach(() => {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", "");
  vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "true"); // on in production: the account reading suggests the Standards of Conduct
});
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");

describe("CA_SALES_POLICY_ENABLED: the Direct policy fill follows the ticked box", () => {
  it("off: with Other ticked, Direct policy is still filled with the Standards of Conduct (the defect), cleaning and other upkeep alike", () => {
    expect(write(["other"]).values.policy_language ?? "").toMatch(/Standards of Conduct/);
    expect(write(["other"], CLEANING).values.policy_language ?? "").toMatch(/Standards of Conduct/);
  });

  it("on, cleaning: the reading is Other (withCleaningOther), so no Standards of Conduct is filled", () => {
    on();
    expect(write(["other"], CLEANING).values.policy_language ?? "").not.toMatch(/Standards of Conduct/);
  });

  it("on, upkeep moved to Other by the model's basis: no Standards of Conduct is written into Direct policy", () => {
    on();
    expect(write(["other"]).values.policy_language ?? "").not.toMatch(/Standards of Conduct/);
  });

  it("on, negatives: the Standards of Conduct ticked keeps its line; nothing ticked is as before", () => {
    on();
    expect(write(["standards_of_conduct"]).values.policy_language ?? "").toMatch(/Standards of Conduct/);
    expect(write([]).values.policy_language ?? "").toMatch(/Standards of Conduct/);
  });
});
