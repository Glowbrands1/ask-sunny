import { describe, expect, it } from "vitest";

import manual151 from "@/test/fixtures/jba-manual-production-151.json";

import { parseFormDocument } from "./document";
import { correctiveActionDocument } from "./library";
import { isFrontMatter, policyFieldValue } from "./policy-citation";
import { applyDerivedPolicyFields, manualReferenceValue } from "./policy-fields";
import type { PolicyGrounding } from "./policy-grounding";

/**
 * ============================================================================
 * A CONTENTS PAGE IS NEVER A POLICY SOURCE — QA, 25 OCT 2026
 * ============================================================================
 *
 * Two Corrective Action drafts of 24 Oct 2026 (form_instance_values, field
 * policy_language) put the JBA Policy Manual's table of contents in Direct
 * policy: rows of dot leaders, and on one of them "Source: JBA Policy Manual —
 * Table of Contents, p. 4". The managers' words (synthetic name):
 *
 *   "CA for Test Employee, register short $40 on 10-20, payroll deduct $40
 *    applies" / "verbal" / "yes payroll deduct"
 *   "Written CA for Test Employee, cash drawer short $65 on 10-19, payroll
 *    deduction of $65 applies"
 *
 * No offense box had a manual section (Violation of Company Policies, or none
 * ticked), so Direct policy fell back to retrieval, and retrieval scored the
 * contents row "Payroll Deductions ..... 39" with the sections themselves. The
 * sources and scores below are the drafts' own provenance; the passages are
 * the production chunks (the contents chunk from
 * knowledge_chunks_toc_backup_20261024, chunk 13; the rest from
 * jba-manual-production-151.json).
 */

const MANUAL_ID = manual151.document_ids["ask-sunny"];
const MANUAL_TITLE = "JBA Policy Manual Edited 5.2025";

/** Chunk 13 of the manual as indexed on 24 Oct 2026 (locator "Page 4 — Table of Contents"). */
const CONTENTS_CHUNK_13 =
  "38\nPayroll Deductions ..................................................................................................................................\n\n39\nGarnishment of Employee Wages .......................................................................................................... 39\nTravel time/cost reimbursements (for travel NOT requiring overnight stays) ....................................... 39\nOvernight Travel Reimbursement........................................................................................................... 39";

function chunkText(locator: string): string {
  if (locator === "Page 4 — Table of Contents") return CONTENTS_CHUNK_13;
  const row = manual151.chunks.find((chunk) => chunk.locator === locator);
  if (!row) throw new Error(`no chunk at ${locator}`);
  return row.content.trim().slice(0, 1200);
}

function retrieval(sources: readonly { locator: string; score: number; documentId?: string; documentTitle?: string }[]): PolicyGrounding {
  const full = sources.map((source) => ({
    documentId: source.documentId ?? MANUAL_ID,
    documentTitle: source.documentTitle ?? MANUAL_TITLE,
    locator: source.locator,
    score: source.score,
  }));
  return {
    unverified: false,
    reason: null,
    sources: full,
    passages: full
      .filter((source) => source.documentId === MANUAL_ID)
      .map((source) => ({ text: chunkText(source.locator), source })),
  };
}

/** instance c33d07f5…, conv 81225096…: "CA for Test Employee, register short $40 on 10-20, payroll deduct $40 applies". */
const REGISTER_SHORT_40 = retrieval([
  { locator: "Page 39 — Bonus Policy", score: 0.888669278880039 },
  { locator: "Page 4 — Table of Contents", score: 0.886118531227112 },
  { locator: "Page 38 — Pay Periods", score: 0.862542867660522 },
  { locator: "Page 41 — Important Notes", score: 0.859683939237361 },
]);

/** instance 47945292…, conv c414fe80…: "Written CA for Test Employee, cash drawer short $65 on 10-19, payroll deduction of $65 applies". */
const DRAWER_SHORT_65 = retrieval([
  { locator: "Page 4 — Table of Contents", score: 0.861797716075114 },
  { locator: "Page 39 — Bonus Policy", score: 0.849183252405122 },
  { locator: "Page 35 — Pay on Separation of Employment", score: 0.845990164936478 },
  { locator: "Page 2", score: 0.845620538163798, documentId: "doc-asd-sd-bonus", documentTitle: "ASD SD Bonus Policy 2.1.2026" },
]);

const DOT_LEADERS = /\.{4,}/;

describe("Direct policy never cites the manual's contents page (Sunny drafts of 24 Oct 2026)", () => {
  it('"register short $40": the contents page is dropped and the next real section is cited', () => {
    const value = manualReferenceValue(REGISTER_SHORT_40, MANUAL_ID)!;
    expect(value).not.toMatch(/Table of Contents/);
    expect(value).not.toMatch(DOT_LEADERS);
    expect(value).toContain("Source: JBA Policy Manual — Bonus Policy, p. 39");
    expect(value).toContain("Source: JBA Policy Manual — Pay Periods, p. 38");
  });

  it('"cash drawer short $65": the contents rows are not the wording, and the next real section is cited', () => {
    const value = manualReferenceValue(DRAWER_SHORT_65, MANUAL_ID)!;
    expect(value).not.toMatch(/Table of Contents/);
    expect(value).not.toMatch(DOT_LEADERS);
    expect(value).not.toMatch(/^38\nPayroll Deductions/);
    expect(value).toContain("Source: JBA Policy Manual — Bonus Policy, p. 39");
    expect(value).toContain("Source: JBA Policy Manual — Pay on Separation of Employment, p. 35");
  });

  it("the draft's own call (Violation of Company Policies ticked, no manual section) writes the same line", () => {
    const result = applyDerivedPolicyFields({
      document: parseFormDocument(correctiveActionDocument()),
      variantKey: null,
      values: {},
      checked: { offense_type: ["company_policies"] },
      grounding: DRAWER_SHORT_65,
      fieldKeys: new Set(["policy_violated", "policy_language"]),
      manualReference: null,
      officialManualDocumentId: MANUAL_ID,
    });
    expect(result.values.policy_violated).toBe("Violation of Company Policies");
    expect(result.values.policy_language).not.toMatch(/Table of Contents/);
    expect(result.values.policy_language).not.toMatch(DOT_LEADERS);
    expect(result.values.policy_language).toContain("Source: JBA Policy Manual — Bonus Policy, p. 39");
  });

  it("only front matter retrieved: no citation at all", () => {
    const onlyContents = retrieval([{ locator: "Page 4 — Table of Contents", score: 0.9 }]);
    expect(manualReferenceValue(onlyContents, MANUAL_ID)).toBeNull();
  });
});

describe("front matter, recognised", () => {
  it("by the section the locator names, or by the passage reading as a contents page", () => {
    expect(isFrontMatter({ sectionTitle: "Table of Contents" })).toBe(true);
    expect(isFrontMatter({ sectionTitle: "TABLE OF CONTENTS" })).toBe(true);
    expect(isFrontMatter({ sectionTitle: "Index" })).toBe(true);
    expect(isFrontMatter({ sectionTitle: "Cover Page" })).toBe(true);
    // Some contents chunks carry only "Page 2" (knowledge_chunks_toc_backup_20261024): the dot leaders give it away.
    expect(isFrontMatter({ sectionTitle: null, policyText: CONTENTS_CHUNK_13 })).toBe(true);
    expect(isFrontMatter({ sectionTitle: "Bonus Policy", policyText: chunkText("Page 39 — Bonus Policy") })).toBe(false);
    expect(isFrontMatter({ sectionTitle: "Standards of Conduct", policyText: chunkText("Page 12 — Standards of Conduct") })).toBe(false);
  });

  it("policyFieldValue leaves a front-matter passage out, and is null when nothing else is left", () => {
    const contents = {
      policyText: CONTENTS_CHUNK_13,
      documentTitle: "JBA Policy Manual",
      sectionTitle: "Table of Contents",
      pageLabel: "4",
      documentId: MANUAL_ID,
      source: "knowledge_retrieval" as const,
    };
    const bonus = { ...contents, policyText: "Payroll Deductions apply.", sectionTitle: "Bonus Policy", pageLabel: "39" };
    expect(policyFieldValue([contents, bonus])).toBe("Payroll Deductions apply.\n\nSource: JBA Policy Manual — Bonus Policy, p. 39");
    expect(policyFieldValue([contents])).toBeNull();
  });
});
