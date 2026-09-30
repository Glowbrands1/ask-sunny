import { describe, expect, it } from "vitest";

import { resolvePolicyManual, type ManualCandidateDocument } from "./official-policy-manual";
import { locatorParts, manualGroundedPolicies, policyFieldValue, sectionWording, sourceLine, verbatimExcerpt } from "./policy-citation";

/**
 * ============================================================================
 * "SHIFT REPLACEMENT — TEXT" ON A DRESS-CODE CORRECTIVE ACTION (live, 29 Sep)
 * ============================================================================
 *
 * After the Woven initial sync, the corpus held the uploaded JBA manual AND
 * Woven's copy of the same PDF (plus a Woven policy merely titled after it).
 * The pinned-manual lookup refused them all as "ambiguous", so the form fell
 * through to naming the best-scoring retrieval hit — the Woven policy "Shift
 * Replacement", whose plain-text chunks are labelled "Text" — as the official
 * manual. These tests hold both halves of the fix.
 */

const doc = (over: Partial<ManualCandidateDocument> & Pick<ManualCandidateDocument, "id" | "title" | "original_filename">): ManualCandidateDocument => ({ tags: [], source: "upload", ...over });

/** The live candidates, as the Production corpus held them. */
const LIVE = [
  doc({ id: "upload", title: "JBA Policy Manual Edited 5.2025", original_filename: "JBA-Policy-Manual-Edited-5.2025.pdf" }),
  doc({ id: "woven-handbook", title: "JBA Policy Manual Edited 5.2025", original_filename: "JBA-Policy-Manual-Edited-5.2025.pdf", source: "woven", tags: ["woven", "woven-handbook"] }),
  doc({ id: "woven-policy-text", title: "JBA Policy Manual 2025", original_filename: "policy-3d90671a.txt", source: "woven" }),
  doc({ id: "woven-policy-pdf", title: "JBA Policy Manual 2025 — 2025 JBA Policy Manual Master - Edited 5-2025 with acknowledgement", original_filename: "2025-JBA-Policy-Manual-Master-Edited-5-2025-with-acknowledgement.pdf", source: "woven" }),
  doc({ id: "shift", title: "Shift Replacement", original_filename: "policy-be999ad3.txt", source: "woven" }),
];

describe("which document is the official manual, after the Woven sync", () => {
  it("the live corpus resolves to Woven's copy of the manual's own file, not 'ambiguous'", () => {
    expect(resolvePolicyManual(LIVE)).toEqual({ ok: true, document: LIVE[1], matchedBy: "fallback" });
  });

  it("the file name outranks a title: a record merely titled after the manual is not the manual", () => {
    const resolution = resolvePolicyManual(LIVE.filter((d) => d.id !== "woven-handbook"));
    expect(resolution).toMatchObject({ ok: true, document: { id: "upload" } });
  });

  it("two copies of the same kind are still refused, never picked by row order", () => {
    expect(resolvePolicyManual([LIVE[0]!, { ...LIVE[0]!, id: "upload-2" }])).toEqual({ ok: false, problem: "ambiguous" });
    expect(resolvePolicyManual([LIVE[1]!, { ...LIVE[1]!, id: "woven-2" }])).toEqual({ ok: false, problem: "ambiguous" });
  });

  it("a tag still wins outright", () => {
    const tagged = { ...LIVE[0]!, tags: ["official-policy-manual"] };
    expect(resolvePolicyManual([tagged, ...LIVE.slice(1)])).toMatchObject({ ok: true, document: { id: "upload" }, matchedBy: "tag" });
  });
});

describe("the source line states only what the knowledge base states", () => {
  it.each([
    ["Page 15 — Dress Code for The Company", "15", "Dress Code for The Company"],
    ["Pages 15–16 — Hair", "15–16", "Hair"],
    ["Page 3", "3", null],
    ["Confidentiality", null, "Confidentiality"],
    ["Text", null, null],
    ["Document body", null, null],
    ["", null, null],
  ])("%s → page %s, section %s", (locator, page, section) => {
    expect(locatorParts(locator)).toEqual({ pageLabel: page, sectionTitle: section });
  });

  it("title, section and page — then fewer, never invented", () => {
    expect(sourceLine({ documentTitle: "JBA Policy Manual", sectionTitle: "Dress Code for The Company", pageLabel: "15" })).toBe("Source: JBA Policy Manual — Dress Code for The Company, p. 15");
    expect(sourceLine({ documentTitle: "JBA Policy Manual", sectionTitle: "Hair", pageLabel: "15–16" })).toBe("Source: JBA Policy Manual — Hair, pp. 15–16");
    expect(sourceLine({ documentTitle: "JBA Policy Manual", sectionTitle: "Dress Code for The Company", pageLabel: null })).toBe("Source: JBA Policy Manual — Dress Code for The Company");
    expect(sourceLine({ documentTitle: "STC Dress Code", sectionTitle: null, pageLabel: null })).toBe("Source: STC Dress Code");
  });

  it("an extractor label never reaches the form as a section", () => {
    const value = policyFieldValue([{ policyText: "Swap shifts through the app.", documentTitle: "Shift Replacement", ...locatorParts("Text"), documentId: "x", source: "knowledge_retrieval" }]);
    expect(value).toBe("Swap shifts through the app.\n\nSource: Shift Replacement");
    expect(value).not.toContain("— Text");
  });

  it("wording is verbatim, cut only at a sentence end (or marked)", () => {
    const long = `${"Employees are to keep a neat, clean appearance. ".repeat(20)}`;
    const cut = verbatimExcerpt(long, 200);
    expect(long.startsWith(cut)).toBe(true);
    expect(cut.endsWith(".")).toBe(true);
    expect(verbatimExcerpt("x".repeat(300), 100).endsWith("…")).toBe(true);
  });
});

describe("the pinned manual's section, as a grounded policy", () => {
  const chunks = [
    {
      chunkIndex: 7,
      page: 16,
      printedPage: 15,
      content: "15 | P a g e\nDress Code for\nThe Company\nEmployees are to keep a neat, clean, professional appearance at all times.\nShoes\nClosed-toe shoes only.",
      sections: [
        { heading: "Dress Code for The Company", page: 15 },
        { heading: "Shoes", page: 15 },
      ],
    },
  ];
  const section = { heading: "Dress Code for The Company", page: 15, chunkIndex: 7, foundBy: "sheet_heading" as const };

  it("quotes the section's own wording — heading matched across a line break — and stops at the next heading", () => {
    expect(sectionWording(chunks, section)).toBe("Employees are to keep a neat, clean, professional appearance at all times.");
  });

  it("carries title, section, printed page and document id, and renders the field", () => {
    const grounded = manualGroundedPolicies({ documentId: "woven-handbook", documentTitle: "JBA Policy Manual Edited 5.2025", chunks }, [section]);
    expect(grounded).toEqual([
      {
        policyText: "Employees are to keep a neat, clean, professional appearance at all times.",
        documentTitle: "JBA Policy Manual",
        sectionTitle: "Dress Code for The Company",
        pageLabel: "15",
        documentId: "woven-handbook",
        source: "official_policy_manual",
      },
    ]);
    expect(policyFieldValue(grounded)).toBe(
      "Employees are to keep a neat, clean, professional appearance at all times.\n\nSource: JBA Policy Manual — Dress Code for The Company, p. 15",
    );
  });
});

describe("the live Production chunk (Woven copy of the JBA manual, chunk 44)", () => {
  /* Verbatim from Production's knowledge_chunks, 30 September 2026. */
  const LIVE_CHUNK = {
    chunkIndex: 44,
    page: 16,
    printedPage: 15,
    content:
      "Dress Code for The Company\nThe Company Employees are to keep a neat, clean, professional appearance at all times. Anyone\nviolating their Brand’s Dress code policy will be sent home to change into proper work attire and\nmay be subject to disciplinary action, up to and potentially including termination.\n\nAll Locations Dress Code:\nName tags\no Name tags are to be worn and visible at all times while working.",
    sections: [
      { heading: "Dress Code for The Company", page: 15 },
      { heading: "All Locations Dress Code", page: 15 },
    ],
  };

  it("renders the dress-code wording, stopping at the next printed heading, with its source", () => {
    const [policy] = manualGroundedPolicies({ documentId: "ce6b00f1-ff30-565f-b446-53fd268a1695", documentTitle: "JBA Policy Manual Edited 5.2025", chunks: [LIVE_CHUNK] }, [
      { heading: "Dress Code for The Company", page: 15, chunkIndex: 44, foundBy: "sheet_heading" },
    ]);
    expect(policyFieldValue([policy!])).toBe(
      "The Company Employees are to keep a neat, clean, professional appearance at all times. Anyone\nviolating their Brand’s Dress code policy will be sent home to change into proper work attire and\nmay be subject to disciplinary action, up to and potentially including termination.\n\n" +
        "Source: JBA Policy Manual — Dress Code for The Company, p. 15",
    );
  });
});
