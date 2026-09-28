import { readFileSync } from "node:fs";

import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { DEFAULT_PERMISSION_MATRIX, ROLES, hasPermission } from "@/lib/permissions";

import { FORM_CATEGORIES, groupTemplatesByCategory } from "./catalog";
import {
  checkboxGroupsForVariant,
  fieldsForVariant,
  parseFormDocument,
  responsibilityMap,
  type FormBlock,
} from "./document";
import { SENSITIVE_ACTION_OPTION_KEYS } from "./escalation-guard";
import { EXIT_TEMPLATE_KEY, EXIT_YES_NO_QUESTIONS } from "./exit-library";
import { EXIT_DERIVED_KEYS } from "./exit-facts";
import { supportsInlineDraft } from "./inline-draft";
import { readZipText } from "./ingest/zip";
import { TEMPLATE_SEEDS } from "./library";
import { renderFormPdf } from "./pdf-render";
import { ESCALATION_OPTION_KEYS, performanceManagementGovernance } from "./pm-governance";
import { enforceResponsibilities } from "./responsibility";

const seed = TEMPLATE_SEEDS.find((entry) => entry.key === EXIT_TEMPLATE_KEY)!;
const document = parseFormDocument(seed.document);
const SOURCE = new Uint8Array(readFileSync("src/test/fixtures/forms/stc-exit.docx"));

/** Every visible string the template prints. */
function printed(blocks: readonly FormBlock[]): string[] {
  return blocks.flatMap((block): string[] => {
    switch (block.kind) {
      case "letterhead":
        return [block.title, block.brand];
      case "section":
        return [block.label];
      case "paragraph":
      case "note":
      case "acknowledgement":
        return [block.text];
      case "field":
        return [block.field.label];
      case "field_row":
        return block.fields.map((field) => field.label);
      case "checkbox_group":
        return [block.label ?? "", ...block.options.map((option) => option.label)];
      case "signature_row":
        return [block.label, block.dateLabel];
      default:
        return [];
    }
  });
}

/** The Word document's words, run together per paragraph, header included. */
function sourceText(): string {
  const xml = [readZipText(SOURCE, "word/header1.xml"), readZipText(SOURCE, "word/document.xml")].join("");
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((paragraph) =>
      [...paragraph[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(""),
    )
    .join("\n")
    .replace(/&amp;/g, "&")
    .replace(/Click or tap (?:here )?to enter (?:text|a date)\./g, "");
}

describe("the Resignation/Exit Form is the STC Exit document", () => {
  it("is in the library, under its own category, permission and layout", () => {
    expect(seed).toMatchObject({
      key: "stc-exit",
      name: "Resignation/Exit Form",
      category: "separation",
      layoutFamily: "exit",
      requiredPermission: "create_exit_form",
      variants: [],
      revision: 1,
    });
    expect(FORM_CATEGORIES.map((category) => category.key)).toContain("separation");
    const orders = TEMPLATE_SEEDS.map((entry) => entry.displayOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("prints every heading, label, option and sentence of the source, in its words", () => {
    const source = sourceText();
    const strip = (text: string) =>
      text.replace(/[’']/g, "'").replace(/\s+/g, " ").replace(/:\s*$/, "").trim();
    const flat = strip(source);
    for (const text of printed(document.blocks).filter(Boolean)) {
      expect(flat, text).toContain(strip(text));
    }
  });

  it("leaves out nothing the source prints", () => {
    const ours = printed(document.blocks).map((text) => text.replace(/[’']/g, "'")).join("\n");
    const wanted = [
      "Resignation/Exit Form",
      "Employee Information",
      "Name",
      "Job Title",
      "Location",
      "Permanent Address",
      "Last Day Worked",
      "Resignation Details",
      "Submitted & Fulfilled Notice",
      "Date that notice was given",
      "Date that notice was fulfilled",
      "Immediate Voluntary Resignation",
      "Immediate involuntary separation",
      "Did not fulfill required 14 day / 30 day notice",
      "No Call No Show",
      "All store items were returned",
      "Is Payroll Deduction applicable? *",
      "*Do they forfeit their bonus?",
      "*Are they to be dropped to minimum wage?",
      "Written notice attached?",
      "Is this employee eligible for rehire?",
      "Details",
      "Acknowledgement of Receipt",
      "By signing this form, I confirm that I understand the information in this resignation/exit form.",
      "use the back of this form for comments",
      "Employee Signature",
      "Supervisor Signature",
      "District Manager/Witness Signature (when required)",
      "Steps to Finish Termination",
      "Upload Exit Form to employee's personal file and remove employee from MyGlow.",
      "Notify home office of employee's final date of employment for HR, Payroll, and Security System purposes.",
      "Place comment on employee's Sunlync account stating they are no longer employed, verify tanning has been removed.",
    ];
    for (const text of wanted) expect(ours, text).toContain(text);
  });

  it("does not carry the source's pre-ticked 'Written notice attached? No'", () => {
    // The Word file was saved with the No box ticked. That is somebody's answer, not the form.
    expect(sourceText()).toMatch(/Written notice attached\?/);
    expect(readZipText(SOURCE, "word/document.xml")).toContain("☒");
    // A template has no default answers at all; a fresh draft is blank until someone ticks it.
    expect(JSON.stringify(seed.document)).not.toContain("☒");
    expect(JSON.stringify(seed.document)).not.toMatch(/"default|checked"/);
  });
});

describe("who writes what", () => {
  const responsibilities = responsibilityMap(document, null);

  it("the yes/no questions and the address belong to the manager", () => {
    for (const question of EXIT_YES_NO_QUESTIONS) {
      expect(responsibilities.get(question.key), question.key).toBe("manager");
    }
    expect(responsibilities.get("permanent_address")).toBe("manager");
  });

  it("the header comes from the record, and the derived facts are the only other drafted keys", () => {
    for (const key of ["employee_name", "form_date", "job_title", "location"]) {
      expect(responsibilities.get(key), key).toBe("system");
    }
    const drafted = [...responsibilities.entries()]
      .filter(([, responsibility]) => responsibility === "ai")
      .map(([key]) => key)
      .sort();
    expect(drafted).toEqual([...EXIT_DERIVED_KEYS, "details"].sort());
  });

  it("the three signature lines have nothing to write into", () => {
    const signatures = document.blocks.filter((block) => block.kind === "signature_row");
    expect(signatures).toHaveLength(3);
    expect(fieldsForVariant(document, null).some((field) => /signature/i.test(field.key))).toBe(false);
  });

  it("a draft that tries to answer a yes/no question or sign has it dropped", () => {
    const result = enforceResponsibilities(document, null, {
      values: { permanent_address: "1 Invented St", details: "Left on 9/15." },
      checked: {
        eligible_for_rehire: ["no"],
        payroll_deduction_applicable: ["yes"],
        store_items_returned: ["yes"],
        written_notice_attached: ["no"],
        forfeit_bonus: ["yes"],
        dropped_to_minimum_wage: ["yes"],
      },
    });
    expect(result.values).toEqual({ details: "Left on 9/15." });
    expect(result.checked).toEqual({});
    expect(result.rejected).toHaveLength(7);
  });

  it("the involuntary option is refused to the model, and no option makes this a ladder form", () => {
    const options = checkboxGroupsForVariant(document, null).flatMap((group) =>
      group.options.map((option) => option.key),
    );
    expect(SENSITIVE_ACTION_OPTION_KEYS.has("immediate_involuntary_separation")).toBe(true);
    expect(options.filter((key) => ESCALATION_OPTION_KEYS.has(key))).toEqual([]);
    expect(
      performanceManagementGovernance({ layoutFamily: "exit", document, variantKey: null }).governed,
    ).toBe(false);
  });

  it("the steps to finish termination are text, with nothing that could record them as done", () => {
    const at = document.blocks.findIndex(
      (block) => block.kind === "section" && block.label === "Steps to Finish Termination",
    );
    const after = document.blocks.slice(at + 1);
    expect(after).toHaveLength(3);
    expect(after.every((block) => block.kind === "paragraph")).toBe(true);
  });
});

describe("where it is offered, and to whom", () => {
  it("can be created and edited in chat", () => {
    expect(supportsInlineDraft(EXIT_TEMPLATE_KEY, [])).toBe(true);
  });

  it("lands in its own section of Forms -> Create a Form", () => {
    const groups = groupTemplatesByCategory(
      TEMPLATE_SEEDS.map((entry) => ({ key: entry.key, category: entry.category })),
    );
    expect(groups.map((group) => group.label)).toEqual([
      "HR & Performance Forms",
      "Separation & Exit Forms",
      "Hiring & Interview Forms",
    ]);
    expect(groups[1]!.templates.map((entry) => entry.key)).toEqual(["stc-exit"]);
    // An unknown category still falls into the LAST section, as it always did.
    const unknown = groupTemplatesByCategory([{ key: "x", category: "from-a-newer-build" }]);
    expect(unknown[0]!.label).toBe("Hiring & Interview Forms");
  });

  it("is granted to exactly the roles that file a Corrective Action Form", () => {
    for (const role of ROLES) {
      expect(
        hasPermission(DEFAULT_PERMISSION_MATRIX, role, "create_exit_form"),
        role,
      ).toBe(hasPermission(DEFAULT_PERMISSION_MATRIX, role, "create_corrective_action"));
    }
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", "create_exit_form")).toBe(false);
    expect(
      hasPermission(DEFAULT_PERMISSION_MATRIX, "assistant_salon_director", "create_exit_form"),
    ).toBe(false);
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "salon_director", "create_exit_form")).toBe(true);
  });

  it("needs a migration for its layout family, and the migration only adds the value", () => {
    const sql = readFileSync(
      "supabase/migrations/20260928001000_forms_exit_layout_family.sql",
      "utf8",
    );
    expect(sql).toMatch(/alter type public\.form_layout_family add value if not exists 'exit'/i);
    const statements = sql.replace(/--.*$/gm, "").split(";").map((part) => part.trim()).filter(Boolean);
    expect(statements).toHaveLength(1);
  });
});

describe("the printed draft", () => {
  it("prints the facts, leaves the rest blank, and signs nothing", async () => {
    const bytes = renderFormPdf(
      document,
      null,
      {
        values: {
          employee_name: "Jordan Vance",
          form_date: "2026-09-28",
          job_title: "Tanning Consultant",
          last_day_worked: "2026-09-15",
          notice_given_date: "2026-09-01",
          details: "Jordan gave two weeks notice on 9/1 and worked through 9/15.",
        },
        checked: { resignation_notice: ["submitted_fulfilled_notice"] },
      },
      {
        templateName: seed.name,
        templateVersion: 1,
        employeeName: "Jordan Vance",
        formDate: "2026-09-28",
        status: "draft",
      },
    );
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain("DRAFT");
    expect(text).toContain("Resignation/Exit Form");
    expect(text).toContain("Jordan gave two weeks notice on 9/1");
    expect(text).toContain("Steps to Finish Termination");
    expect(text).toContain("District Manager/Witness Signature (when required)");
    expect(text).not.toMatch(/\?\s*Upload/); // no mangled bullet glyph before a step
  });
});
