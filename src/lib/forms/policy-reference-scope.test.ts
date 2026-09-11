import { describe, expect, it } from "vitest";

import { manualReferenceValue } from "./policy-fields";
import { APPROVED_POLICY_CATEGORIES } from "./policy-grounding";
import type { PolicyGrounding, PolicySource } from "./policy-grounding";
import type { KnowledgeCategory } from "@/types";

/**
 * ============================================================================
 * WHAT MAY BE NAMED AS "THE OFFICIAL MANUAL", AND WHAT MAY NOT
 * ============================================================================
 *
 * Policy retrieval searches every category that can carry a rule the company
 * issues — policies, operations, safety, equipment and pay. That widening is
 * right for finding the PASSAGE that licenses saying a rule was broken, and it
 * is the reason the field stopped coming back blank.
 *
 * IT IS NOT RIGHT FOR THE REFERENCE LINE. Measured against the live corpus,
 * those five categories hold:
 *
 *   safety                20 documents, of which 18 are equipment
 *                         troubleshooting guides — "UV Tanning Bed
 *                         Troubleshooting", "PEMF Chair", "Hydromassage".
 *   operations            7, including three interviewing documents and the
 *                         JBA Policy Manual itself.
 *   equipment_procedures  1, a troubleshooting cheat sheet.
 *
 * A Corrective Action Form ticked for an offense the manual states no section
 * for used to fall through to the retrieval-built reference, so "Direct policy
 * from official manual" could read "UV Tanning Bed Troubleshooting" on an
 * employment record. Nobody would read that as anything but a mistake — and it
 * would be a mistake that looks checked.
 *
 * So the reference may name ONLY the pinned official manual. Everything else
 * leaves the field blank for the manager, which is the safe failure the whole
 * area is built on. The retrieved passages are untouched: what licenses the
 * OBSERVATION is a separate question from what may be NAMED as the manual.
 */

const MANUAL_ID = "doc-jba-manual";

function source(overrides: Partial<PolicySource> = {}): PolicySource {
  return {
    documentId: MANUAL_ID,
    documentTitle: "JBA Policy Manual Edited 5.2025",
    locator: "Page 15 — Dress Code for The Company",
    score: 0.61,
    ...overrides,
  };
}

function grounding(sources: PolicySource[]): PolicyGrounding {
  return {
    passages: sources.map((s) => ({ text: "…", source: s })),
    sources,
    unverified: false,
    reason: null,
  };
}

describe("1. the categories retrieval may search", () => {
  /*
   * Asserted so that widening this list is a deliberate act with a test to
   * delete, not a one-line edit nobody reviews.
   */
  it("is the set of shelves holding rules the company issues", () => {
    expect([...APPROVED_POLICY_CATEGORIES].sort()).toEqual(
      [
        "bonuses_compensation",
        "equipment_procedures",
        "operations",
        "policies_compliance",
        "safety",
      ].sort(),
    );
  });

  it("excludes teaching material, frameworks and the uncategorised shelf", () => {
    const excluded: KnowledgeCategory[] = [
      // Holds the Performance Management Framework: how to reason, not a rule.
      "leadership_coaching",
      // A training deck describing the dress code is not the dress code.
      "training",
      "sales_client_experience",
      "reports_analytics",
      // A catch-all would make anything anybody uploaded quotable.
      "other",
    ];

    for (const category of excluded) {
      expect(APPROVED_POLICY_CATEGORIES).not.toContain(category);
    }
  });
});

describe("2. the reference names the official manual or nothing", () => {
  it("names the manual when retrieval found it", () => {
    expect(manualReferenceValue(grounding([source()]), MANUAL_ID)).toBe(
      "JBA Policy Manual — Page 15 — Dress Code for The Company",
    );
  });

  /*
   * ==========================================================================
   * THE REAL DOCUMENTS THAT USED TO BE NAMEABLE
   * ==========================================================================
   *
   * Every title below is a row in the live corpus, in a category policy
   * retrieval searches. Each one scores above the match floor for some phrasing
   * a manager might type, and none of them is a policy anybody is disciplined
   * under.
   */
  it.each([
    ["UV Tanning Bed Troubleshooting", "safety"],
    ["PEMF Chair", "safety"],
    ["Spa Equipment Troubleshooting", "safety"],
    ["VersaPro Troubleshooting Cheat Sheet", "equipment_procedures"],
    ["Best Practices for Interviewing", "operations"],
    ["00. Interviewing Core Process 2025", "operations"],
    ["KBL Cheat Sheet", "operations"],
  ])("refuses to name %s (%s) as the official manual", (title) => {
    const hit = source({ documentId: "doc-other", documentTitle: title, score: 0.9 });

    expect(manualReferenceValue(grounding([hit]), MANUAL_ID)).toBeNull();
  });

  it("ignores an unrelated document even when it outscores the manual", () => {
    const value = manualReferenceValue(
      grounding([
        source({ documentId: "doc-other", documentTitle: "PEMF Chair", score: 0.95 }),
        source({ score: 0.4 }),
      ]),
      MANUAL_ID,
    );

    expect(value).toBe("JBA Policy Manual — Page 15 — Dress Code for The Company");
  });

  it("joins several sections of the manual, and nothing from anywhere else", () => {
    const value = manualReferenceValue(
      grounding([
        source({ locator: "Page 15 — Dress Code for The Company", score: 0.7 }),
        source({ locator: "Page 14 — Attendance", score: 0.5 }),
        source({ documentId: "doc-other", documentTitle: "KBL Cheat Sheet", score: 0.99 }),
      ]),
      MANUAL_ID,
    );

    expect(value).toBe(
      "JBA Policy Manual — Page 15 — Dress Code for The Company; Page 14 — Attendance",
    );
  });

  it("prints the manual's name without the revision the corpus files it under", () => {
    expect(manualReferenceValue(grounding([source()]), MANUAL_ID)).not.toContain("5.2025");
  });

  it("stays blank when grounding is unverified, whatever was retrieved", () => {
    const unverified: PolicyGrounding = {
      passages: [],
      sources: [source()],
      unverified: true,
      reason: "nothing matched",
    };

    expect(manualReferenceValue(unverified, MANUAL_ID)).toBeNull();
  });

  /*
   * A DEPLOYMENT WITH NO PINNED MANUAL keeps the old behaviour, because there
   * is nothing narrower to offer it. This is the one path on which another
   * approved document can still be named, and it is stated rather than left to
   * be discovered.
   */
  it("falls back to the best approved document when no manual is identified", () => {
    const hit = source({ documentId: "doc-other", documentTitle: "Glow Brands Integrity Guide" });

    expect(manualReferenceValue(grounding([hit]), null)).toBe(
      "Glow Brands Integrity Guide — Page 15 — Dress Code for The Company",
    );
  });
});
