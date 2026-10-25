import { describe, expect, it } from "vitest";

import manual151 from "@/test/fixtures/jba-manual-production-151.json";

import type { ManualChunk } from "./official-policy-manual";
import { headingWithPrintedPage, printedPageLabel, withPolicyPagesOnCard } from "./policy-page-on-card";

/**
 * POLICY_PAGE_ON_CARD_ENABLED, the reader under it. The pages are checked
 * against the production JBA Policy Manual rows (all 151, md5-verified against
 * both apps' databases), not against the code: Standards of Conduct is printed
 * on page 12 (PDF sheet 13), Late Opening on 15 (sheet 16), the Cell
 * Phone/Smart Watch Policy on 19 (sheet 20).
 */

type Row = (typeof manual151.chunks)[number];

const CHUNKS: ManualChunk[] = (manual151.chunks as Row[]).map((row) => ({
  chunkIndex: row.chunk_index,
  page: row.page,
  printedPage: row.metadata.printedPage ?? null,
  content: row.content,
  section: row.section,
  sections: row.metadata.sections,
  locator: row.locator,
}));

describe("printed page for a manual heading (production manual)", () => {
  it.each([
    ["Standards of Conduct", "p.12"],
    ["Late Opening", "p.15"],
    ["Cell Phone/Smart Watch Policy", "p.19"],
    ["Attendance", "p.14"],
    ["Animals in the Workplace", "p.30"],
  ])("%s is %s, the printed page and not the PDF sheet", (heading, label) => {
    expect(printedPageLabel(heading, CHUNKS)).toBe(label);
  });

  it("a heading whose own chunk runs over two printed pages is a range", () => {
    // Chunk 89: locator "Pages 26–27 — Employee Injury/Illness in the Workplace & Related Accommodations".
    expect(printedPageLabel("Employee Injury/Illness in the Workplace & Related Accommodations", CHUNKS)).toBe("pp.26–27");
  });

  it("a name the manual does not print as a heading gets no page", () => {
    expect(printedPageLabel("Dress Code", CHUNKS)).toBeNull();
    expect(printedPageLabel("Violation of Company Policies", CHUNKS)).toBeNull();
    expect(printedPageLabel("Under Performance", CHUNKS)).toBeNull();
  });

  it("a heading printed on two different pages, or without a page, gets no page", () => {
    const twice: ManualChunk[] = [
      { chunkIndex: 0, page: 4, printedPage: 3, content: "", sections: [{ heading: "Breaks", page: 3 }] },
      { chunkIndex: 1, page: 10, printedPage: 9, content: "", sections: [{ heading: "Breaks", page: 9 }] },
    ];
    expect(printedPageLabel("Breaks", twice)).toBeNull();
    const none: ManualChunk[] = [{ chunkIndex: 0, page: 4, content: "", sections: [{ heading: "Breaks", page: 0 }] }];
    expect(printedPageLabel("Breaks", none)).toBeNull();
  });

  it("keeps the heading exactly as the app wrote it", () => {
    expect(headingWithPrintedPage("Standards of Conduct", CHUNKS)).toBe("Standards of Conduct (JBA Policy Manual p.12)");
  });
});

describe("the card's own policy lines get the page; nothing else changes", () => {
  it("the remap card line (QA: Policy: Standards of Conduct, no page)", () => {
    const card = [
      "Here is the Corrective Action Form.",
      "**Employee:** Test Employee",
      "**What happened:** Failed to acknowledge policies in woven by the 10-15-26 deadline",
      "**Policy:** Standards of Conduct, as you said",
      "",
      "What is their job title?",
    ].join("\n");
    expect(withPolicyPagesOnCard(card, CHUNKS)).toBe(
      card.replace("**Policy:** Standards of Conduct, as you said", "**Policy:** Standards of Conduct (JBA Policy Manual p.12), as you said"),
    );
  });

  it("the proposal's policy line, a bare Late Opening line and a 'reads as' line", () => {
    expect(
      withPolicyPagesOnCard(
        "**Policy:** Late Opening, as you said. I'll quote that section from the current policy manual on the draft.",
        CHUNKS,
      ),
    ).toBe(
      "**Policy:** Late Opening (JBA Policy Manual p.15), as you said. I'll quote that section from the current policy manual on the draft.",
    );
    expect(withPolicyPagesOnCard("**Policy:** Late Opening", CHUNKS)).toBe("**Policy:** Late Opening (JBA Policy Manual p.15)");
    expect(
      withPolicyPagesOnCard("**Policy:** this reads as **Standards of Conduct** — a required deadline that was missed.", CHUNKS),
    ).toBe("**Policy:** this reads as **Standards of Conduct** (JBA Policy Manual p.12) — a required deadline that was missed.");
  });

  it("never alters the manager's words, a line that already has a page, or a name without one page", () => {
    const unchanged = [
      '**Policy:** "visitors at work", as you said. I\'ll look for that section in the current policy manual.',
      "**Policy:** Standards of Conduct Policy, JBA Policy Manual p.12, as you said",
      '**Policy:** "cell phone" reads as the policy manual\'s **Cell Phone/Smart Watch Policy** (page 19).',
      "**Policy:** Dress Code, as you said",
      "**Policy:** Violation of Company Policies, as you said. The policy manual has no single section to quote for it.",
      "**Policy:** Attendance — missing the monthly meeting is an absence from a scheduled shift.",
      "**What happened:** Standards of Conduct, as you said",
      "Policy: Standards of Conduct, as you said",
    ];
    for (const line of unchanged) expect(withPolicyPagesOnCard(line, CHUNKS)).toBe(line);
    const card = "**Policy:** Standards of Conduct, as you said";
    expect(withPolicyPagesOnCard(card, [])).toBe(card);
  });
});
