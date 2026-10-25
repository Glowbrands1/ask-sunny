import { afterEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { formTurnCitations } from "@/lib/ai/form-card-slots";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";
import { describedManualSection } from "./named-policy-section";
import type { ManualChunk } from "./official-policy-manual";

/**
 * ============================================================================
 * CLEANING LEFT UNDONE IS CARE AND CLEANING, CHOSEN BY THE CODE
 * (POLICY_CLEANING_INCIDENT_ENABLED)
 * ============================================================================
 *
 * QA, 25 Oct 2026, in the managers' exact words (names invented):
 *
 *   T5  "cleaning duties not being completed", "weren't done", "didn't get
 *       done", "left dirty" -> a policy: Care and Cleaning of Equipment and
 *       Facilities p.21 when the account names cleaning or equipment,
 *       Standards of Conduct otherwise.
 *   9   the same chat gave Standards of Conduct p.12 on one run and Care and
 *       Cleaning p.21 on another: when the manager's words name the incident
 *       type, the code chooses, not the model.
 *
 * Fails with the flag off (no policy read; the model's heading stands) and
 * passes with it on.
 */

const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);
const CARE = "Care and Cleaning of Equipment and Facilities";

const CLEANING = [
  "Create a verbal corrective action for Ione Varga, Salon Director, for cleaning duties not being completed.",
  "Ione Varga's cleaning duties weren't done on 10-18-26.",
  "The cleaning didn't get done during Ione Varga's shift on 10-18-26.",
  "Ione Varga left the beds dirty at close on 10-18-26.",
  "Ione Varga did not do the sanitize clean on the beds on 10-18-26.",
] as const;

const DUTIES = [
  "Ione Varga's closing duties weren't done on 10-18-26.",
  "Ione Varga's opening checklist didn't get done on 10-18-26.",
] as const;

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("POLICY_CLEANING_INCIDENT_ENABLED", "true");
const cited = (text: string) => accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`);

describe("flag off: main reads no policy (the bug)", () => {
  it.each([...CLEANING.slice(0, 4), ...DUTIES])("%s", (text) => {
    expect(readCaPolicy(text).suggestion).toBeNull();
    expect(cited(text)).toEqual([]);
  });
});

describe("flag on: cleaning is Care and Cleaning p.21", () => {
  it.each(CLEANING)("%s", (text) => {
    on();
    expect(readCaPolicy(text).suggestion).toBeNull();
    expect(describedManualSection({ text, chunks: CHUNKS })?.section).toMatchObject({ heading: CARE, page: 21 });
    expect(cited(text)).toEqual([`${CARE} p.21`]);
  });

  it("the proposal says so, as a reading the manager can change", () => {
    on();
    const text = CLEANING[0];
    const found = describedManualSection({ text, chunks: CHUNKS })!;
    const line = caPolicyProposalLine(readCaPolicy(text), {
      phrase: found.phrase,
      lookup: "described",
      heading: found.section.heading,
      page: found.section.page,
      offenseKey: found.offenseKey,
    });
    expect(line).toContain(`**${CARE}** (page 21)`);
  });

  it("the card cites p.21 whatever heading the model chose (item 9: same chat, same policy)", () => {
    on();
    for (const modelHeading of ["Standards of Conduct", CARE, null]) {
      const citations = formTurnCitations({
        notes: CLEANING[1],
        chunks: CHUNKS,
        documentId: "manual",
        documentTitle: "JBA Policy Manual",
        modelHeading,
      });
      expect(citations.map((citation) => citation.locator)).toEqual(["Page 21"]);
    }
  });

  it("a policy the manager named still wins", () => {
    on();
    expect(cited("Ione Varga's cleaning duties weren't done. The policy violated is the standards of conduct.")).toEqual([
      "Standards of Conduct p.12",
    ]);
  });
});

describe("flag on: other duties left undone are the Standards of Conduct", () => {
  it.each(DUTIES)("%s", (text) => {
    on();
    const reading = readCaPolicy(text);
    expect(reading.suggestion).toBe("standards_of_conduct");
    expect(caPolicyProposalLine(reading)).toContain("**Standards of Conduct**");
    expect(describedManualSection({ text, chunks: CHUNKS })).toBeNull();
  });
});

describe("flag on: not an account of cleaning left undone", () => {
  it.each([
    "Ione Varga cleaned the beds before close.",
    "What is the cleaning policy?",
    "Ione Varga was late on 10-18-26 and the cleaning was done by someone else.",
  ])("%s", (text) => {
    on();
    expect(describedManualSection({ text, chunks: CHUNKS })?.section.heading).not.toBe(CARE);
  });
});
