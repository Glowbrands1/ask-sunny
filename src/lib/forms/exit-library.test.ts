import { readFileSync } from "node:fs";

import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { DEFAULT_PERMISSION_MATRIX, ROLES, hasPermission } from "@/lib/permissions";

import { FORM_CATEGORIES, groupTemplatesByCategory } from "./catalog";
import {
  answerStatementText,
  checkboxGroupsForVariant,
  fieldsForVariant,
  parseFormDocument,
  responsibilityMap,
  type FormBlock,
} from "./document";
import { SENSITIVE_ACTION_OPTION_KEYS } from "./escalation-guard";
import {
  EXIT_ANSWER_LINES,
  EXIT_DETAIL_FIELDS,
  EXIT_DETAIL_LABEL,
  EXIT_TEMPLATE_KEY,
  EXIT_YES_NO_QUESTIONS,
  SALON_KEY_DEDUCTION_STATEMENT,
} from "./exit-library";
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
      case "answer_statements":
        return block.lines.map((line) => line.label);
      default:
        return [];
    }
  });
}

/**
 * WHAT HR ADDED IN REVISION 2 (Colene Schildt, 28 Sep 2026), and nothing else.
 * Every other printed string must still be the Word document's own.
 */
const HR_ADDED = new Set<string>([
  ...Object.values(EXIT_DETAIL_LABEL),
  "Salon key was returned",
  "Additional Details",
]);

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
      revision: 2,
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
      if (HR_ADDED.has(text)) continue;
      expect(flat, text).toContain(strip(text));
    }
  });

  it("adds exactly HR's Details lines, inside the Details section, and the salon key question", () => {
    const added = printed(document.blocks).filter((text) => HR_ADDED.has(text));
    expect(new Set(added)).toEqual(HR_ADDED);
    const labels = (from: string, to: string) => {
      const start = document.blocks.findIndex((block) => block.kind === "section" && block.label === from);
      const end = document.blocks.findIndex((block) => block.kind === "section" && block.label === to);
      return printed(document.blocks.slice(start + 1, end));
    };
    // HR's order and HR's words, then the manager's paragraph.
    expect(labels("Details", "Acknowledgement of Receipt")).toEqual([
      "Resignation Date",
      "How Employee Resigned",
      "Reason for Resignation",
      "Store Items Returned",
      "Salon Key Returned",
      "Payroll Deduction",
      "Minimum Wage / Bonus Forfeiture",
      "Eligible for Rehire",
      "Additional Details",
    ]);
    // The key question sits with the other yes/no questions, straight after store items.
    const questions = labels("Resignation Details", "Details").filter((text) =>
      EXIT_YES_NO_QUESTIONS.some((question) => question.label === text),
    );
    expect(questions.slice(0, 2)).toEqual(["All store items were returned", "Salon key was returned"]);
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

  it("the yes/no questions, HR's Details facts and the address belong to the manager", () => {
    for (const question of EXIT_YES_NO_QUESTIONS) {
      expect(responsibilities.get(question.key), question.key).toBe("manager");
    }
    for (const key of Object.values(EXIT_DETAIL_FIELDS)) {
      expect(responsibilities.get(key), key).toBe("manager");
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
      values: {
        permanent_address: "1 Invented St",
        details: "Left on 9/15.",
        resignation_date: "2026-09-15",
        resignation_method: "Text message",
        resignation_reason: "Moving away.",
      },
      checked: {
        salon_key_returned: ["no"],
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
    expect(result.rejected).toHaveLength(11);
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
      "Employment Change Forms",
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

describe("the Details lines", () => {
  const line = (label: string) => EXIT_ANSWER_LINES.find((entry) => entry.label === label)!;
  const say = (label: string, checked: Record<string, string[]>) => answerStatementText(line(label), checked);

  it("state each answer in HR's words, and nothing for a question nobody answered", () => {
    expect(say("Store Items Returned", { store_items_returned: ["yes"] })).toBe("Store items were returned.");
    expect(say("Store Items Returned", { store_items_returned: ["no"] })).toBe("Store items were not returned.");
    expect(say("Salon Key Returned", { salon_key_returned: ["yes"] })).toBe("Salon key was returned.");
    expect(say("Salon Key Returned", { salon_key_returned: ["no"] })).toBe(
      "Salon key was not returned. Employee will be payroll deducted $25 for the salon key.",
    );
    expect(SALON_KEY_DEDUCTION_STATEMENT).toBe("Employee will be payroll deducted $25 for the salon key.");
    expect(say("Payroll Deduction", { payroll_deduction_applicable: ["yes"] })).toBe("Payroll deduction is applicable.");
    expect(say("Payroll Deduction", { payroll_deduction_applicable: ["no"] })).toBe("Payroll deduction is not applicable.");
    expect(say("Eligible for Rehire", { eligible_for_rehire: ["yes"] })).toBe("Employee is eligible for rehire.");
    expect(say("Eligible for Rehire", { eligible_for_rehire: ["no"] })).toBe("Employee is not eligible for rehire.");
    for (const label of ["Store Items Returned", "Salon Key Returned", "Payroll Deduction", "Eligible for Rehire"]) {
      expect(say(label, {}), label).toBe("");
      // Both boxes ticked by hand is not an answer either.
      const key = line(label).parts[0]!.key;
      expect(say(label, { [key]: ["yes", "no"] }), label).toBe("");
    }
  });

  it("say minimum wage and the bonus together, and only the half that was answered", () => {
    const wage = (drop: string[], bonus: string[]) =>
      say("Minimum Wage / Bonus Forfeiture", { dropped_to_minimum_wage: drop, forfeit_bonus: bonus });
    expect(wage(["yes"], ["yes"])).toBe("Employee will be dropped to minimum wage and forfeit bonus.");
    expect(wage(["no"], ["no"])).toBe("Employee will not be dropped to minimum wage and will not forfeit bonus.");
    expect(wage(["yes"], ["no"])).toBe("Employee will be dropped to minimum wage and will not forfeit bonus.");
    expect(wage(["no"], ["yes"])).toBe("Employee will not be dropped to minimum wage and will forfeit bonus.");
    expect(wage(["yes"], [])).toBe("Employee will be dropped to minimum wage.");
    expect(wage([], ["no"])).toBe("Employee will not forfeit bonus.");
    expect(wage([], [])).toBe("");
  });

  it("are echoes: the block owns no key, so each answer is stored once", () => {
    const keys = [...responsibilityMap(document, null).keys()];
    for (const entry of EXIT_ANSWER_LINES) {
      for (const part of entry.parts) {
        expect(keys.filter((key) => key === part.key), part.key).toHaveLength(1);
        expect(checkboxGroupsForVariant(document, null).some((group) => group.key === part.key)).toBe(true);
      }
    }
  });

  it("a document that echoes a group it does not have is refused", () => {
    const broken = JSON.parse(JSON.stringify(seed.document)) as { blocks: FormBlock[] };
    const statements = broken.blocks.find((block) => block.kind === "answer_statements")!;
    if (statements.kind === "answer_statements") statements.lines[0]!.parts[0]!.key = "store_itmes_returned";
    expect(() => parseFormDocument(broken)).toThrow(/not a checkbox group/);
  });

  it("show every date MM/DD/YYYY, and a revision 1 form still prints exactly as it did", async () => {
    expect(document.style?.dateFormat).toBe("us");
    const values = {
      values: {
        employee_name: "Jordan Vance",
        form_date: "2026-09-28",
        last_day_worked: "2026-09-15",
        notice_given_date: "2026-09-01",
        notice_fulfilled_date: "2026-09-15",
        resignation_date: "2026-09-01",
      },
      checked: {},
    };
    const meta = { templateName: seed.name, templateVersion: 2, employeeName: "Jordan Vance", formDate: "2026-09-28", status: "draft" as const };
    const text = async (doc: typeof document) =>
      (await extractText(await getDocumentProxy(renderFormPdf(doc, null, values, meta)), { mergePages: true })).text.replace(/\s+/g, " ");

    const current = await text(document);
    for (const line of [
      "Date 09/28/2026",
      "Last Day Worked 09/15/2026",
      "Date that notice was given 09/01/2026",
      "Date that notice was fulfilled 09/15/2026",
      "Resignation Date 09/01/2026",
      "Jordan Vance | 09/28/2026 | DRAFT",
    ]) {
      expect(current, line).toContain(line);
    }
    expect(current).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);

    // A form pinned to revision 1 carries no date format, and keeps printing ISO.
    const { dateFormat: _unused, ...revisionOneStyle } = document.style!;
    void _unused;
    const pinned = await text({ ...document, style: revisionOneStyle });
    expect(pinned).toContain("Last Day Worked 2026-09-15");
    expect(pinned).toContain("Jordan Vance | 2026-09-28 | DRAFT");
  });

  it("never separate the acknowledgement from the signature lines under it", async () => {
    // A fully answered form: the longest the Details section gets.
    const checked = Object.fromEntries(EXIT_YES_NO_QUESTIONS.map((question) => [question.key, ["no"]]));
    const bytes = renderFormPdf(
      document,
      null,
      {
        values: {
          employee_name: "Jordan Vance",
          form_date: "2026-09-28",
          resignation_date: "2026-09-20",
          resignation_method: "Text message",
          resignation_reason: "Moving out of state.",
          details: "Jordan texted the Salon Director before opening and did not return.",
        },
        checked,
      },
      { templateName: seed.name, templateVersion: 2, employeeName: "Jordan Vance", formDate: "2026-09-28", status: "draft" },
    );
    const { text: pages } = await extractText(await getDocumentProxy(bytes), { mergePages: false });
    const onPage = (needle: string) => pages.findIndex((page) => page.replace(/\s+/g, " ").includes(needle));
    const acknowledgement = onPage("By signing this form, I confirm");
    expect(acknowledgement).toBeGreaterThanOrEqual(0);
    for (const line of ["Employee Signature", "Supervisor Signature", "District Manager/Witness Signature"]) {
      expect(onPage(line), line).toBe(acknowledgement);
    }
  });

  it("print on the PDF exactly as the form shows them, and a blank for what is unanswered", async () => {
    const bytes = renderFormPdf(
      document,
      null,
      {
        values: {
          employee_name: "Jordan Vance",
          form_date: "2026-09-28",
          resignation_date: "2026-09-20",
          resignation_method: "Phone call",
          resignation_reason: "Going back to school.",
          details: "Jordan called the salon before opening.",
        },
        checked: {
          store_items_returned: ["no"],
          salon_key_returned: ["no"],
          dropped_to_minimum_wage: ["yes"],
          forfeit_bonus: ["yes"],
        },
      },
      {
        templateName: seed.name,
        templateVersion: 2,
        employeeName: "Jordan Vance",
        formDate: "2026-09-28",
        status: "finalized",
      },
    );
    const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain("Resignation Date 09/20/2026");
    expect(flat).toContain("Date 09/28/2026");
    expect(flat).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(flat).toContain("How Employee Resigned Phone call");
    expect(flat).toContain("Reason for Resignation Going back to school.");
    expect(flat).toContain("Store Items Returned Store items were not returned.");
    expect(flat).toContain(
      "Salon Key Returned Salon key was not returned. Employee will be payroll deducted $25 for the salon key.",
    );
    expect(flat).toContain("Minimum Wage / Bonus Forfeiture Employee will be dropped to minimum wage and forfeit bonus.");
    expect(flat).toContain("Additional Details Jordan called the salon before opening.");
    // Unanswered: the label prints over a blank rule, and no sentence is invented.
    expect(flat).toMatch(/Payroll Deduction Minimum Wage/);
    expect(flat).toMatch(/Eligible for Rehire Additional Details/);
    expect(flat).not.toMatch(/Payroll deduction is|eligible for rehire\./);
  });
});
