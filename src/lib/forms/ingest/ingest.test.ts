import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseFormDocument, type FormDocument } from "../document";
import { coachingDocument } from "../library";
import { alignToCurrent } from "./align";
import { buildOutline, line, readFieldLine, stripPlaceholders } from "./outline";
import { readDocxHtml, splitCheckboxes } from "./read-docx";
import { readPdfText, splitGlyphCheckboxes } from "./read-pdf";
import { outlineToDocument, slugify } from "./to-document";
import { readHints } from "./refine";
import { isWordArchive, readZipText } from "./zip";

/**
 * ============================================================================
 * READING A BUSINESS DOCUMENT INTO A FORM
 * ============================================================================
 *
 * The end-to-end cases run against the REAL Coaching Form, in both formats,
 * from `src/test/fixtures/forms`. That is the point of keeping the files: the
 * reported defect was about those exact documents, and a parser tested only on
 * lines written to suit it proves nothing about them.
 *
 * The acceptance bar is deliberately absolute. Both formats must produce a
 * document EQUAL to the hand-written Coaching Form — not "close", not "has the
 * right topics", equal. Anything less and the difference is a question nobody
 * would answer until a manager noticed it on a signed record.
 */

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`src/test/fixtures/forms/${name}`));

/** The pipeline, minus the parts that need a database or a network. */
function pipeline(lines: ReturnType<typeof line>[], current: FormDocument | null) {
  const outline = buildOutline(lines, { brand: "Sun Tan City" });
  const generated = outlineToDocument(outline);
  const aligned = alignToCurrent(generated.document, current);
  return {
    outline,
    document: parseFormDocument(aligned.document),
    warnings: [...generated.warnings, ...aligned.warnings],
    report: aligned.report,
  };
}

/* ====================================================== the PDF, for real === */

describe("the Coaching Form as a flat PDF", () => {
  /*
   * ZERO ACROFORM FIELDS. This is the document that was uploaded, succeeded,
   * and changed nothing — and the reason it changed nothing is that there is no
   * fillable field in it to read. Everything below is read from the page text.
   */
  const PAGE_TEXT = [
    "Coaching Form",
    "Sun Tan City",
    "Employee Information",
    "Name: Click or tap here to enter text. Date: Click or tap to enter a date.",
    "Job Title: Click or tap here to enter text. Location: Click or tap here to enter text.",
    "Type of Coaching",
    "☐ Underperformance ☐ Training Plan of Action ☐ Retraining",
    "Topic of Coaching",
    "☐ Store Tours ☐ Engaging Conversation ☐ Engaging Questions",
    "☐ Relevant Recommendations ☐Overcoming Objections ☐ Product Basics",
    "☐ Completing the Engagement ☐ Sales Strategies/Upselling ☐ Cleaning Tasks",
    "☐ New Client Documents ☐ Other: Click or tap here to enter text.",
    "Details of Coaching",
    "Click or tap here to enter text.",
    "Acknowledgement of Coaching",
    "I confirm that my supervisor and I have discussed this training and plan for improvement.",
    "Click or tap here to enter text. Click or tap to enter a date.",
    "Employee Signature Date",
    "Click or tap here to enter text. Click or tap to enter a date.",
    "Supervisor Signature Date",
  ].join("\n");

  const result = pipeline(readPdfText(PAGE_TEXT), coachingDocument());

  it("produces exactly the published Coaching Form", () => {
    expect(result.document).toEqual(parseFormDocument(coachingDocument()));
  });

  it("understands every line, and flags nothing", () => {
    expect(result.outline.unresolved).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("reads the required Employee Information lines", () => {
    const labels = result.document.blocks
      .filter((block) => block.kind === "field_row")
      .flatMap((block) => (block.kind === "field_row" ? block.fields : []))
      .map((field) => field.label);
    expect(labels).toEqual(["Name", "Date", "Job Title", "Location"]);
  });

  it("reads the three types of coaching", () => {
    expect(optionLabels(result.document, 0)).toEqual([
      "Underperformance",
      "Training Plan of Action",
      "Retraining",
    ]);
  });

  it("reads all eleven topics, over four printed rows, as ONE group", () => {
    expect(optionLabels(result.document, 1)).toEqual([
      "Store Tours",
      "Engaging Conversation",
      "Engaging Questions",
      "Relevant Recommendations",
      "Overcoming Objections",
      "Product Basics",
      "Completing the Engagement",
      "Sales Strategies/Upselling",
      "Cleaning Tasks",
      "New Client Documents",
      "Other",
    ]);
    const groups = result.document.blocks.filter((block) => block.kind === "checkbox_group");
    expect(groups, "four rows of ticks are one question, not four").toHaveLength(2);
  });

  it("keeps the Other write-in as well as the Other tick", () => {
    const other = fieldByKey(result.document, "other_topic");
    expect(other?.label).toBe("Other");
    expect(other?.input).toBe("text");
  });

  it("reads Details of Coaching as a multiline field", () => {
    expect(fieldByKey(result.document, "coaching_details")?.input).toBe("long_text");
  });

  it("reads the acknowledgement wording", () => {
    const acknowledgement = result.document.blocks.find(
      (block) => block.kind === "acknowledgement",
    );
    expect(acknowledgement).toMatchObject({
      text: "I confirm that my supervisor and I have discussed this training and plan for improvement.",
    });
  });

  it("reads both signature pairs, and puts no input behind them", () => {
    const signatures = result.document.blocks.filter((block) => block.kind === "signature_row");
    expect(signatures).toEqual([
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date", variantKey: undefined },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date", variantKey: undefined },
    ]);
    // The blank ABOVE each caption is the signature's own rule, and must not
    // have become a text field somebody could type a name into.
    const keys = allKeys(result.document);
    expect(keys.some((key) => /signature/i.test(key))).toBe(false);
  });

  it("introduces none of the superseded options", () => {
    const everything = JSON.stringify(result.document);
    for (const stale of [
      "Salon Tours",
      "Open-ended Questions",
      "Closing the Sale",
      "Client Engagement",
      "Selling Memberships",
      "Upgrading Options",
      "Making Recommendations",
      "Lotion Basics",
    ]) {
      expect(everything, stale).not.toContain(stale);
    }
  });
});

/* ================================================ the real files on disk === */

describe("the supplied files, read end to end", () => {
  it("is a PDF with no fillable fields at all", async () => {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(Uint8Array.from(fixture("coaching-form.pdf")));
    let count = 0;
    try {
      count = Object.keys((await pdf.getFieldObjects()) ?? {}).length;
    } catch {
      count = 0;
    }
    expect(count, "the regression case is a FLAT PDF").toBe(0);
  });

  it("reads the real PDF into the published Coaching Form", async () => {
    const { readPdf } = await import("./read-pdf");
    const reading = await readPdf(fixture("coaching-form.pdf"));
    const result = pipeline(reading.lines, coachingDocument());
    expect(result.document).toEqual(parseFormDocument(coachingDocument()));
    expect(result.outline.unresolved).toEqual([]);
  });

  it("reads the real DOCX into the same form", async () => {
    const { readDocx } = await import("./read-docx");
    const reading = await readDocx(fixture("coaching-form.docx"));
    const result = pipeline(reading.lines, coachingDocument());
    expect(result.document).toEqual(parseFormDocument(coachingDocument()));
    expect(result.outline.unresolved).toEqual([]);
  });

  it("takes the title and brand out of the Word page header", async () => {
    const { readHeaderLines } = await import("./read-docx");
    // Mammoth reports the BODY only, so without this the form would have no
    // name on it — the header is where Word keeps the title.
    expect(readHeaderLines(fixture("coaching-form.docx"))).toEqual([
      "Coaching Form",
      "Sun Tan City",
    ]);
  });

  it("knows the .docx is a Word archive and the .doc is not one", () => {
    expect(isWordArchive(fixture("coaching-form.docx"))).toBe(true);
    expect(isWordArchive(fixture("prescreen-form.doc"))).toBe(false);
    expect(readZipText(fixture("coaching-form.docx"), "word/document.xml")).toContain("w:document");
    expect(readZipText(fixture("coaching-form.docx"), "nope.xml")).toBeNull();
  });
});

/* ========================================================== the rules === */

describe("what the rules read", () => {
  it("splits a tick row into its options, glyphs and all", () => {
    expect(splitGlyphCheckboxes("☐ Store Tours ☐Engaging Conversation ☑ Done")).toEqual([
      "Store Tours",
      "Engaging Conversation",
      "Done",
    ]);
    expect(splitGlyphCheckboxes("no ticks here")).toEqual([]);
  });

  it("splits a Word checkbox paragraph, keeping the lead-in separate", () => {
    const { lead, options } = splitCheckboxes(
      'Final Recommendation: <input type="checkbox" /> Hire <input type="checkbox" /> No Hire',
    );
    expect(lead).toBe("Final Recommendation:");
    expect(options).toEqual(["Hire", "No Hire"]);
  });

  it("reads a labelled blank, and knows a date from text", () => {
    expect(
      readFieldLine("Name: Click or tap here to enter text. Date: Click or tap to enter a date."),
    ).toEqual([
      { label: "Name", input: "text" },
      { label: "Date", input: "date" },
    ]);
    expect(readFieldLine("Interviewed by: _______")).toEqual([
      { label: "Interviewed by", input: "text" },
    ]);
  });

  it("never lets a placeholder become a label", () => {
    expect(stripPlaceholders("Name: Click or tap here to enter text.")).toBe("Name:");
    expect(stripPlaceholders("_________")).toBe("");
  });

  it("reports a line it cannot place instead of guessing", () => {
    const outline = buildOutline([
      line("Some Form"),
      line("Employee Information"),
      // One blank has a label in front of it and one does not, so which label
      // belongs to which blank is a guess. It is reported instead.
      line("____ then Name: Click or tap here to enter text."),
    ]);
    expect(outline.unresolved).toHaveLength(1);
    expect(outline.unresolved[0]!.reason).toMatch(/labelled and unlabelled/);
  });

  it("makes a stable key from a label", () => {
    expect(slugify("Sales Strategies/Upselling")).toBe("sales_strategies_upselling");
    expect(slugify("  ")).toBe("field");
  });

  it("does not eat a heading as a brand when the brand is unknown", () => {
    // Safe direction: a heading kept is a heading a reviewer can see, and a
    // heading swallowed as a brand is one that vanished.
    const outline = buildOutline([line("Coaching Form"), line("Employee Information"), line("Name: ____")]);
    expect(outline.nodes[0]).toMatchObject({ kind: "title", text: "Coaching Form" });
    expect(outline.nodes[1]).toMatchObject({ kind: "heading", text: "Employee Information" });
  });
});

/* ================================================== AcroForm consumption === */

describe("a fillable PDF", () => {
  /*
   * A fillable PDF prints no blank where a widget sits, so its text layer reads
   * "Name:" and stops. Without the declared fields, this document would produce
   * headings and nothing to fill in.
   */
  const TEXT = ["Coaching Form", "Employee Information", "Name:", "Date:", "Details of Coaching"].join("\n");
  const HINTS = [
    { name: "Name", type: "text", multiline: false, options: [] },
    { name: "Date", type: "text", multiline: false, options: [] },
    { name: "Details of Coaching", type: "text", multiline: true, options: [] },
  ];

  it("puts the blanks back from the declared fields", () => {
    const result = pipeline(readPdfText(TEXT, HINTS), null);
    const labels = allFields(result.document).map((field) => field.label);
    expect(labels).toEqual(["Name", "Date", "Details of Coaching"]);
  });

  it("reads a multiline field as the writing area under its heading", () => {
    const result = pipeline(readPdfText(TEXT, HINTS), null);
    const details = allFields(result.document).find(
      (field) => field.label === "Details of Coaching",
    );
    expect(details?.input).toBe("long_text");
  });

  it("ignores a declared field that nothing on the page is labelled with", () => {
    const result = pipeline(
      readPdfText("Coaching Form\nEmployee Information\nName:", [
        ...HINTS,
        { name: "SecretInternalField", type: "text", multiline: false, options: [] },
      ]),
      null,
    );
    // A field name is not a question. Only what the page PRINTS becomes a label.
    expect(JSON.stringify(result.document)).not.toContain("SecretInternalField");
  });

  it("leaves a flat PDF alone", () => {
    const flat = readPdfText("Name: Click or tap here to enter text.");
    expect(flat[0]!.text).toBe("Name: Click or tap here to enter text.");
  });
});

/* ======================================================= Word structure === */

describe("Word structure", () => {
  it("keeps headings, bold section bars, checkboxes and tables in order", () => {
    const { lines } = readDocxHtml(
      [
        "<h1>Interview</h1>",
        "<p><strong>Applicant Information</strong></p>",
        "<p><strong>Name</strong>: Click or tap here to enter text.</p>",
        '<p><input type="checkbox" /> Outgoing <input type="checkbox" /> Competitive</p>',
        "<table><tr><td><p>Observation Area</p></td><td><p>Key Notes</p></td></tr></table>",
      ].join(""),
      ["Coaching Form", "Sun Tan City"],
    );
    expect(lines[0]).toMatchObject({ text: "Coaching Form", chrome: true });
    expect(lines[2]).toMatchObject({ text: "Interview", headingLevel: 1 });
    expect(lines[3]).toMatchObject({ text: "Applicant Information", emphasised: true });
    expect(lines[4]!.text).toContain("Click or tap here to enter text.");
    expect(lines[5]!.checkboxes).toEqual(["Outgoing", "Competitive"]);
    // The table's cells survive as text rather than being dropped.
    expect(lines.some((entry) => entry.text.includes("Observation Area"))).toBe(true);
  });

  it("decodes entities rather than printing them", () => {
    const { lines } = readDocxHtml("<p>Sales &amp; Client Service &#8212; notes</p>");
    expect(lines[0]!.text).toBe("Sales & Client Service — notes");
  });
});

/* =========================================================== alignment === */

describe("aligning a re-issued form to the one it replaces", () => {
  const current = coachingDocument();

  it("keeps the keys the engine fills the header from", () => {
    const result = pipeline(
      readPdfText("Coaching Form\nEmployee Information\nName: ____\nDate: ____"),
      current,
    );
    const keys = allFields(result.document).map((field) => field.key);
    expect(keys).toEqual(["employee_name", "form_date"]);
  });

  it("keeps who fills each field, which no document can say", () => {
    const result = pipeline(
      readPdfText("Coaching Form\nDetails of Coaching\nClick or tap here to enter text."),
      current,
    );
    // `ai` on the published form; extraction alone would have said `manager`.
    expect(fieldByKey(result.document, "coaching_details")?.responsibility).toBe("ai");
  });

  it("keeps guidance an author wrote, which is in no source document", () => {
    const result = pipeline(
      readPdfText("Coaching Form\nDetails of Coaching\nClick or tap here to enter text."),
      current,
    );
    expect(fieldByKey(result.document, "coaching_details")?.help).toContain("What was observed");
  });

  it("matches a checkbox group through a wholesale change of options", () => {
    // The topics changed almost completely and it is still the same question.
    const result = pipeline(
      readPdfText("Coaching Form\nTopic of Coaching\n☐ Something New ☐ Something Else"),
      current,
    );
    const group = result.document.blocks.find((block) => block.kind === "checkbox_group");
    expect(group).toMatchObject({ key: "coaching_topics", responsibility: "ai" });
  });

  it("reports a field that is new, and one that has gone", () => {
    const result = pipeline(
      readPdfText("Coaching Form\nEmployee Information\nFavourite Colour: ____"),
      current,
    );
    expect(result.report.added.map((entry) => entry.label)).toContain("Favourite Colour");
    expect(result.report.removed.map((entry) => entry.key)).toContain("employee_name");
    expect(result.warnings.join(" ")).toMatch(/New to this form/);
    expect(result.warnings.join(" ")).toMatch(/Forms already filled keep them/);
  });

  it("keeps the house brand rather than the document's spelling of it", () => {
    const result = pipeline(readPdfText("Coaching Form\nSun Tan City\nEmployee Information\nName: ____"), current);
    const letterhead = result.document.blocks[0];
    expect(letterhead).toMatchObject({ kind: "letterhead", brand: "SUN TAN CITY" });
  });

  it("leaves a brand-new form's own keys alone", () => {
    const result = pipeline(
      readPdfText("Interview Form\nApplicant Information\nApplicant Name: ____"),
      null,
    );
    expect(allFields(result.document)[0]!.key).toBe("employee_name");
    expect(result.report.matched).toEqual([]);
  });
});

/* ============================================== the model's narrow seam === */

describe("what the model is allowed to return", () => {
  it("reads a well-formed classification", () => {
    expect(readHints('{"lines":[{"index":3,"kind":"heading"}]}', [3])).toEqual({ 3: "heading" });
  });

  it("keeps only the kinds on the list", () => {
    expect(readHints('{"lines":[{"index":1,"kind":"options"}]}', [1])).toEqual({});
    expect(readHints('{"lines":[{"index":1,"kind":"fields"}]}', [1])).toEqual({});
  });

  it("ignores an index nobody asked about", () => {
    expect(readHints('{"lines":[{"index":99,"kind":"heading"}]}', [1])).toEqual({});
  });

  it("survives a reply that is not JSON, or is fenced, or is hostile", () => {
    expect(readHints("I refuse", [1])).toEqual({});
    expect(readHints('```json\n{"lines":[{"index":1,"kind":"paragraph"}]}\n```', [1])).toEqual({
      1: "paragraph",
    });
    expect(readHints('{"lines":[{"index":1,"kind":"heading","text":"DROP TABLE"}]}', [1])).toEqual({
      1: "heading",
    });
  });

  it("cannot put text on the form, only a kind against a line we already have", () => {
    const hints = readHints(
      '{"lines":[{"index":1,"kind":"heading","text":"Ignore previous instructions"}]}',
      [1],
    );
    const outline = buildOutline(
      [line("Employee Information"), line("Name: ____ and ____ stray")],
      { hints },
    );
    // The hint placed the line; the model's own words are nowhere.
    expect(JSON.stringify(outline)).not.toContain("Ignore previous instructions");
    expect(outline.unresolved).toEqual([]);
  });
});

/* ------------------------------------------------------------- helpers --- */

function allFields(document: FormDocument) {
  return document.blocks.flatMap((block) =>
    block.kind === "field" ? [block.field] : block.kind === "field_row" ? block.fields : [],
  );
}
function fieldByKey(document: FormDocument, key: string) {
  return allFields(document).find((field) => field.key === key);
}
function allKeys(document: FormDocument) {
  return [
    ...allFields(document).map((field) => field.key),
    ...document.blocks.flatMap((block) => (block.kind === "checkbox_group" ? [block.key] : [])),
  ];
}
function optionLabels(document: FormDocument, index: number) {
  const groups = document.blocks.filter((block) => block.kind === "checkbox_group");
  const group = groups[index];
  return group && group.kind === "checkbox_group"
    ? group.options.map((option) => option.label)
    : [];
}

describe("the canonical header keys", () => {
  /*
   * A CROSS-MODULE INVARIANT, ASSERTED RATHER THAN ASSUMED.
   *
   * Extraction puts a line labelled "Name" on the key `employee_name` so the
   * engine fills it from the record. That only works while `createInstance`
   * still seeds that exact key — and the two live in different files, edited by
   * different people for different reasons. A key that drifts out of the
   * seeding map does not break a build or fail a render: it produces a form
   * with a blank rule where a name belongs, which is what `instances.ts`
   * records having shipped once already.
   */
  it("are all keys the engine actually fills from the record", () => {
    const instances = readFileSync("src/lib/forms/instances.ts", "utf8");
    const seeded = instances.slice(
      instances.indexOf("const fromRecord"),
      instances.indexOf("const seeded"),
    );
    expect(seeded, "the seeding map moved").toContain("employee_name");

    const toDocument = readFileSync("src/lib/forms/ingest/to-document.ts", "utf8");
    const canonical = [...toDocument.matchAll(/key: "([a-z_]+)" \}/g)].map((match) => match[1]!);
    expect(canonical.length).toBeGreaterThan(0);
    for (const key of new Set(canonical)) {
      expect(seeded, `${key} is not seeded by createInstance`).toContain(`${key}:`);
    }
  });
});
