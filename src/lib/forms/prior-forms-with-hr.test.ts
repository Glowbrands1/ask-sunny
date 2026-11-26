import { describe, expect, it } from "vitest";

import { priorsOnFileLine, priorsOnFileOffer } from "@/lib/ai/agent-loop/tools";
import { correctiveActionDocument } from "./library";
import { fieldsForVariant, type FormDocument } from "./document";
import { currentHistoryWording } from "./history-box-wording";
import { priorFormsFromRows, withHr } from "./prior-forms-lines";

/**
 * Pau, 26 Nov 2026, both apps, on the Corrective Action's history box: "just remove the 90 day wording" and "for the
 * count, also add what form is waiting on approval or sent for return still add it on the list for both app".
 * Invented employee.
 */

function row(id: string, templateKey: string, formDate: string, extra: Partial<{ status: string; hrApprovalState: string | null }> = {}) {
  return { id, templateKey, formDate, employeeName: "Juniper Brandvold", status: "finalized", ...extra };
}

describe('"also add what form is waiting on approval or sent for return still add it on the list"', () => {
  it("lists a form waiting for HR approval and one sent back, marked as such, beside the finalized ones", () => {
    const forms = priorFormsFromRows({
      employeeName: "Juniper Brandvold",
      rows: [
        row("co", "coaching", "2026-09-02"),
        row("pending", "dpoa", "2026-10-02", { status: "draft", hrApprovalState: "pending" }),
        row("back", "coaching", "2026-10-20", { status: "draft", hrApprovalState: "changes_requested" }),
      ],
      warningLevels: new Map([["pending", ["verbal"]]]),
    });
    expect(forms.map((form) => form.line)).toEqual([
      "Coaching — signed 09/02/2026",
      "Verbal corrective action, draft, waiting for HR approval — 10/02/2026",
      "Coaching, draft, sent back by HR — 10/20/2026",
    ]);
  });

  it("never says signed or finalized on a form still with HR", () => {
    const [form] = priorFormsFromRows({
      employeeName: "Juniper Brandvold",
      rows: [row("pending", "dpoa", "2026-10-02", { status: "draft", hrApprovalState: "pending" })],
      warningLevels: new Map(),
    });
    expect(form!.line).not.toMatch(/signed|finalized/);
  });

  it("leaves out a draft never sent and a form HR rejected", () => {
    const forms = priorFormsFromRows({
      employeeName: "Juniper Brandvold",
      rows: [
        row("draft", "dpoa", "2026-10-02", { status: "draft", hrApprovalState: null }),
        row("rejected", "dpoa", "2026-10-03", { status: "draft", hrApprovalState: "rejected" }),
      ],
      warningLevels: new Map(),
    });
    expect(forms).toEqual([]);
    expect(withHr({ status: "finalized", hrApprovalState: "approved" })).toBeNull();
  });

  it("the chat's prior actions and its offer say a form is with HR", () => {
    const priors = [
      { form: "Coaching Form", level: null, date: "2026-09-02" },
      { form: "Corrective Action Form", level: "Verbal Warning", date: "2026-10-02", withHr: "draft, waiting for HR approval" },
    ];
    expect(priorsOnFileLine(priors)).toBe(
      "Coaching Form, finalized — 09/02/2026; Corrective Action Form, Verbal Warning, draft, waiting for HR approval — 10/02/2026",
    );
    expect(priorsOnFileOffer("Juniper", priors)).toBe(
      "Juniper has a Coaching Form on file from 09/02/2026 and a Verbal CA draft, waiting for HR approval from 10/02/2026. Want me to add them to Prior actions?",
    );
  });
});

describe('"just remove the 90 day wording"', () => {
  const OLD_LABEL = "List previous coaching and corrective actions and include date signed by employee in past 90 days";
  const OLD_HELP =
    'One per line: each coaching or corrective action received in the past 90 days, with the date the employee signed it. Write "None — first occurrence" when there has been none. Required.';

  function storedRevision9(label: string, help: string): FormDocument {
    const document = correctiveActionDocument();
    return {
      ...document,
      blocks: document.blocks.map((block) =>
        block.kind === "field" && block.field.key === "prior_actions" ? { ...block, field: { ...block.field, label, help } } : block,
      ),
    };
  }
  const history = (document: FormDocument) => fieldsForVariant(document, null).find((field) => field.key === "prior_actions")!;

  it("the form as published now says nothing about 90 days", () => {
    const field = history(correctiveActionDocument());
    expect(field.label).toBe("List previous coaching and corrective actions and include date signed by employee");
    expect(`${field.label} ${field.help}`).not.toMatch(/90 days/);
  });

  it("a stored revision 9 is read without it, and with the N/A help", () => {
    const field = history(currentHistoryWording(storedRevision9(OLD_LABEL, OLD_HELP)));
    expect(field.label).toBe("List previous coaching and corrective actions and include date signed by employee");
    expect(field.help).toContain('"N/A" is filled in automatically');
    expect(field.help).not.toMatch(/90 days/);
  });

  it("a label or help an administrator wrote is kept", () => {
    const document = storedRevision9("Prior steps", "List every step.");
    expect(currentHistoryWording(document)).toBe(document);
  });
});
