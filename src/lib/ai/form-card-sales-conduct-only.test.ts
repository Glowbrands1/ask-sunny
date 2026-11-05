import { afterEach, describe, expect, it } from "vitest";

import manual151 from "@/test/fixtures/jba-manual-production-151.json";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { attachFormTurnSources } from "./form-card-slots";

/**
 * CA_SALES_POLICY_ENABLED (QA round 2, row B, 5 Nov 2026): message 8 ("<name>
 * - verbal / 146 tans / Below in PPTA, LPSVA, Average Club, CC%, Spa%"; the
 * person is invented) put "Evaluations and Raises Policy, JBA Policy Manual
 * p.34" on the card beside the Standards of Conduct, with its excerpt among
 * the sources. Read against the production manual (151 chunks).
 */
const chunks = (manual151.chunks as ChunkRow[]).map(manualChunkFromRow);
// The request is sf-s24's turn 1 (verbatim), which reads as a sales account; message 8 follows it.
const MSG_8 =
  "Can you write me a performace ca for an employee who did not meet their numbers for the month of october Wynne Sarrow  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%\nWynne Sarrow - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%";
/** The Policy line CA_SALES_POLICY_ENABLED writes on the card (`caPolicyProposalLine`). */
const SALES_LINE = "**Policy:** Standards of Conduct — sales performance against goals. I'll cite that section of the current policy manual, with its page, on the draft; tell me if a different policy applies.";

const attach = (modelHeading: string | null) =>
  attachFormTurnSources({ content: "card", citations: [], notes: MSG_8, chunks, documentId: "d", documentTitle: "JBA Policy Manual", modelHeading });

afterEach(() => {
  delete process.env.CA_SALES_POLICY_ENABLED;
});

describe("an underperformance CA cites the Standards of Conduct and nothing beside it", () => {
  it("off, the heading the model chose is cited (the reported card)", () => {
    expect(attach("Evaluations and Raises").content).toContain("Evaluations and Raises Policy, JBA Policy Manual p.34");
  });

  it.each([["Evaluations and Raises"], [null]])("on, with the model's heading %s: Standards of Conduct p.12 only, card and sources", (heading) => {
    process.env.CA_SALES_POLICY_ENABLED = "true";
    const { content, citations } = attach(heading);
    expect(content).toContain("Standards of Conduct Policy, JBA Policy Manual p.12");
    expect(content).not.toMatch(/Evaluations and Raises/);
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.every((citation) => citation.excerpt.startsWith("Standards of Conduct"))).toBe(true);
  });

  it("on, a card whose Policy line names the Standards of Conduct cites only it, whatever the notes read as", () => {
    process.env.CA_SALES_POLICY_ENABLED = "true";
    const { content, citations } = attachFormTurnSources({ content: `card\n\n${SALES_LINE}`, citations: [], notes: "Wynne Sarrow - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%", chunks, documentId: "d", documentTitle: "JBA Policy Manual", modelHeading: "Evaluations and Raises" });
    // The Policy line already names the section, so no second line is added (as before); the page is on the sources.
    expect(content).not.toMatch(/Evaluations and Raises/);
    expect(citations.every((citation) => citation.excerpt.startsWith("Standards of Conduct"))).toBe(true);
  });

  it("on, an account that is not a sales one keeps the model's heading", () => {
    process.env.CA_SALES_POLICY_ENABLED = "true";
    const late = attachFormTurnSources({ content: "card", citations: [], notes: "write a CA for wynne sarrow, she opened the salon late on 11/2", chunks, documentId: "d", documentTitle: "JBA Policy Manual", modelHeading: "Late Opening" });
    expect(late.content).toMatch(/Late Opening/);
  });
});
