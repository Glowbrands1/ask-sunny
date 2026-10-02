import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { fieldsForVariant, parseFormDocument, type FormDocument } from "./document";
import { TEMPLATE_SEEDS } from "./library";
import { renderFormPdf, type RenderMeta } from "./pdf-render";
import { PRIOR_ACTIONS_KEY, PRIOR_ACTIONS_LABEL } from "./prior-actions";
import { CA_ACTION_PLAN_CLOSING } from "./required-closing";

/**
 * ============================================================================
 * THE CORRECTIVE ACTION FORM, REVISION 5 — HR FEEDBACK, 3 OCT 2026
 * ============================================================================
 *
 *   Under Type of Warning, "Previous corrective action for this policy or
 *   issue" and "Date of previous corrective action" are replaced by ONE line:
 *   "List previously received coaching and/or corrective action with date
 *   signed", with room for several entries.
 *
 *   Every Action Plan ends with "Future policy violations may be subject to
 *   additional corrective action up to and including termination of
 *   employment." — on the record and on the PDF.
 *
 * And a form filed on revision 4 prints exactly as it was signed.
 */

const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "dpoa")!;
const document = parseFormDocument(seed.document);

const META: RenderMeta = {
  templateName: "Corrective Action Form",
  templateVersion: 6,
  employeeName: "Jessica Moss",
  formDate: "2026-10-03",
  locationName: "Kearny",
  reference: "form-0005",
  status: "draft",
};

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
  return text;
}

/** How many ruled strokes the page content draws — the lines a value sits on. */
function strokes(bytes: Uint8Array): number {
  // Page content streams are written uncompressed; only images are deflated.
  return Buffer.from(bytes).toString("latin1").match(/ l S/g)?.length ?? 0;
}

/** The revision-4 document, as it is stored on the version forms were filed against. */
function revision4(): FormDocument {
  const blocks = document.blocks.flatMap((block) => {
    if (block.kind === "field" && block.field.key === PRIOR_ACTIONS_KEY) {
      return [
        {
          kind: "field" as const,
          field: { key: "previous_action", label: "Previous corrective action for this policy or issue", input: "text" as const, responsibility: "ai" as const },
        },
        {
          kind: "field" as const,
          field: { key: "previous_action_date", label: "Date of previous corrective action", input: "date" as const, responsibility: "ai" as const },
        },
      ];
    }
    if (block.kind === "field" && block.field.key === "action_plan") {
      const field = { ...block.field };
      delete field.requiredClosing;
      return [{ ...block, field }];
    }
    return [block];
  });
  return parseFormDocument({ ...document, blocks });
}

describe("the template", () => {
  it("is revision 5, published as a new version rather than over revision 4", () => {
    expect(seed.revision).toBe(5);
    expect(seed.revisionNote).toMatch(/Revision 5/);
    expect(seed.key).toBe("dpoa");
  });

  it("has the new field, labelled exactly, under Type of Warning", () => {
    const index = document.blocks.findIndex((block) => block.kind === "section" && block.label === "Type of Warning");
    const next = document.blocks.slice(index + 1, index + 3);
    expect(next[0]).toMatchObject({ kind: "checkbox_group", key: "warning_type" });
    expect(next[1]).toMatchObject({
      kind: "field",
      field: {
        key: "prior_actions",
        label: "List previously received coaching and/or corrective action with date signed",
        input: "long_text",
        responsibility: "ai",
      },
    });
    expect(PRIOR_ACTIONS_LABEL).toBe("List previously received coaching and/or corrective action with date signed");
  });

  it("no longer has either old field", () => {
    const fields = fieldsForVariant(document, null);
    const keys = fields.map((field) => field.key);
    const labels = fields.map((field) => field.label);
    expect(keys).not.toContain("previous_action");
    expect(keys).not.toContain("previous_action_date");
    expect(labels).not.toContain("Previous corrective action for this policy or issue");
    expect(labels).not.toContain("Date of previous corrective action");
  });

  it("gives the new field room for several entries", () => {
    const field = fieldsForVariant(document, null).find((entry) => entry.key === PRIOR_ACTIONS_KEY)!;
    expect(field.input).toBe("long_text");
    expect(field.minLines).toBeGreaterThanOrEqual(4);
  });

  it("declares the Action Plan's closing on the version", () => {
    const plan = fieldsForVariant(document, null).find((entry) => entry.key === "action_plan")!;
    expect(plan.requiredClosing).toBe(CA_ACTION_PLAN_CLOSING);
    // The help text no longer forbids the consequence the closing states.
    expect(plan.help).not.toMatch(/no consequence/i);
  });
});

describe("the printed form", () => {
  it("prints the new label and every entry, one per line", async () => {
    const bytes = renderFormPdf(
      document,
      null,
      {
        values: {
          employee_name: "Jessica Moss",
          [PRIOR_ACTIONS_KEY]: "Coaching — signed 09/02/2026\nVerbal warning — signed 09/21/2026\nWritten warning — signed 09/28/2026",
        },
        checked: { warning_type: ["written"] },
      },
      META,
    );
    const text = await pdfText(bytes);
    expect(text).toContain("List previously received coaching and/or corrective action with date signed");
    expect(text).toContain("Coaching - signed 09/02/2026");
    expect(text).toContain("Verbal warning - signed 09/21/2026");
    expect(text).toContain("Written warning - signed 09/28/2026");
    expect(text).not.toContain("Previous corrective action for this policy or issue");
    expect(text).not.toContain("Date of previous corrective action");
  });

  it("keeps the ruled lines for handwriting on a blank form", () => {
    const blank = renderFormPdf(document, null, { values: {}, checked: {} }, META);
    const withoutRoom = parseFormDocument({
      ...document,
      blocks: document.blocks.map((block) =>
        block.kind === "field" && block.field.key === PRIOR_ACTIONS_KEY
          ? { ...block, field: { ...block.field, minLines: undefined } }
          : block,
      ),
    });
    const tight = renderFormPdf(withoutRoom, null, { values: {}, checked: {} }, META);
    expect(strokes(blank) - strokes(tight)).toBe(3);
  });

  it("ends the Action Plan with the closing when the stored plan lacks it", async () => {
    const plan = "Jessica is expected to adhere to the Sun Tan City attendance policy by arriving on time.";
    const text = await pdfText(renderFormPdf(document, null, { values: { action_plan: plan }, checked: {} }, META));
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain(`${plan} Future policy violations may be subject to additional corrective action up to and including termination of employment.`);
  });

  it("prints the closing once when the stored plan already has it", async () => {
    const plan = `Jessica is expected to arrive on time. ${CA_ACTION_PLAN_CLOSING}`;
    const text = await pdfText(renderFormPdf(document, null, { values: { action_plan: plan }, checked: {} }, META));
    expect(text.replace(/\s+/g, " ").match(/Future policy violations may be subject/g)).toHaveLength(1);
  });

  it("prints the closing on a blank form too", async () => {
    const text = await pdfText(renderFormPdf(document, null, { values: {}, checked: {} }, META));
    expect(text.replace(/\s+/g, " ")).toContain(CA_ACTION_PLAN_CLOSING);
  });
});

describe("a form filed against revision 4", () => {
  it("prints exactly as it was signed: the two old lines, and no closing it did not have", async () => {
    const old = revision4();
    const text = await pdfText(
      renderFormPdf(
        old,
        null,
        {
          values: {
            previous_action: "Verbal warning for tardiness",
            previous_action_date: "2026-09-21",
            action_plan: "Jessica is expected to arrive on time.",
          },
          checked: {},
        },
        { ...META, templateVersion: 5, status: "finalized" },
      ),
    );
    expect(text).toContain("Previous corrective action for this policy or issue");
    expect(text).toContain("Date of previous corrective action");
    expect(text).toContain("Verbal warning for tardiness");
    expect(text).not.toContain("List previously received coaching");
    expect(text).not.toContain("Future policy violations");
  });
});
