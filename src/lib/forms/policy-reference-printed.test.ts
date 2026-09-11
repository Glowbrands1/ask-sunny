import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { parseFormDocument } from "./document";
import { TEMPLATE_SEEDS } from "./library";
import { renderFormPdf } from "./pdf-render";
import { applyDerivedPolicyFields } from "./policy-fields";
import {
  manualSectionsFor,
  officialManualReference,
  type ManualChunk,
} from "./official-policy-manual";

/**
 * ============================================================================
 * THE REFERENCE, READ BACK OUT OF THE PDF A MANAGER DOWNLOADS
 * ============================================================================
 *
 * Every other test in this area asserts on a value in memory. This one renders
 * the Corrective Action Form and parses the bytes, because the citation is only
 * correct if it survives the last step — and the last step is the one nobody
 * looks at until a form is already filed.
 *
 * THE CHUNKS BELOW ARE THE MANUAL'S REAL ROWS: the sheet the dress code is
 * printed on is the PDF's sixteenth and prints "15" in its footer, and 15 is
 * what the citation names.
 *
 * ============================================================================
 * THE EM DASH IS PRINTED AS A HYPHEN, AND THAT IS THE RENDERER'S RULE
 * ============================================================================
 *
 * The form is drawn with the standard-14 fonts and no embedded font, so
 * `asciiOnly` folds an em dash to a hyphen rather than printing the wrong
 * glyph. The stored value — what the fill screen shows, what the API returns,
 * what `form_instance_values` holds — keeps the em dash.
 *
 * Asserted in BOTH SHAPES below so the difference is a recorded fact rather
 * than something discovered on a printed disciplinary record.
 */

const MANUAL: ManualChunk[] = [
  {
    chunkIndex: 44,
    page: 16,
    printedPage: 15,
    sections: [{ heading: "Dress Code for The Company", page: 15 }],
    section: "Dress Code for The Company",
    content:
      "Dress Code for The Company\nThe Company Employees are to keep a neat, clean, professional" +
      " appearance at all times.",
  },
];

const DOCUMENT_TITLE = "JBA Policy Manual Edited 5.2025";

function correctiveActionForm() {
  const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "dpoa")!;
  return { seed, document: parseFormDocument(seed.document) };
}

function fieldKeysOf(document: ReturnType<typeof parseFormDocument>) {
  const keys = new Set<string>();
  for (const block of document.blocks) {
    if (block.kind === "field") keys.add(block.field.key);
    if (block.kind === "field_row") for (const field of block.fields) keys.add(field.key);
  }
  return keys;
}

describe("the policy reference a manager downloads", () => {
  const { seed, document } = correctiveActionForm();
  const checked = { offense_type: ["dress_code"], warning_type: ["written"] };

  const sections = manualSectionsFor({
    chunks: MANUAL,
    offenseKeys: checked.offense_type,
    jobTitle: "Tanning Consultant",
  });

  const derived = applyDerivedPolicyFields({
    document,
    variantKey: null,
    values: { employee_name: "Jordan Vance", form_date: "2026-09-11" },
    checked,
    grounding: { passages: [], sources: [], unverified: true, reason: null },
    fieldKeys: fieldKeysOf(document),
    manualReference: officialManualReference(DOCUMENT_TITLE, sections),
    officialManualDocumentId: "doc-manual",
  });

  it("stores the manual, the topic and the printed page, in that order", () => {
    expect(derived.values.policy_language).toBe(
      "JBA Policy Manual — Dress Code for The Company — Page 15",
    );
  });

  it("names the offense box on the line above it", () => {
    expect(derived.values.policy_violated).toBe("Dress Code Violation");
  });

  it("drops the revision the corpus files the manual under", () => {
    expect(derived.values.policy_language).not.toContain("5.2025");
    expect(derived.values.policy_language).not.toContain(".pdf");
  });

  it("cites the page the manual prints, not the PDF's sheet", () => {
    // The dress code sits on the PDF's sixteenth sheet. 16 must not appear.
    expect(derived.values.policy_language).toContain("Page 15");
    expect(derived.values.policy_language).not.toContain("Page 16");
  });

  it("prints all three parts on the generated PDF", async () => {
    const bytes = renderFormPdf(
      document,
      null,
      { values: derived.values, checked },
      {
        templateName: seed.name,
        templateVersion: 4,
        employeeName: "Jordan Vance",
        formDate: "2026-09-11",
        locationName: "Invented Store Alpha",
        reference: "form-0001",
        status: "finalized",
      },
    );

    const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    const printed = String(text);

    expect(printed).toContain("JBA Policy Manual - Dress Code for The Company - Page 15");
    expect(printed).toContain("Direct policy from official manual");
    // The rename the business asked for, on the sheet itself.
    expect(printed).toContain("Corrective Action Form");
    expect(printed).not.toContain("Disciplinary Plan of Action");
  });
});
