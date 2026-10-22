import { describe, expect, it } from "vitest";

import { priorFormsFromRows } from "./prior-forms-lines";

function row(id: string, templateKey: string, formDate: string, extra: Partial<{ employeeName: string; status: string }> = {}) {
  return { id, templateKey, formDate, employeeName: "Juniper Brandvold", status: "finalized", ...extra };
}

describe("the forms on file that count as history", () => {
  it("lists finalized Coaching and Corrective Action forms, oldest first, with the CA's level", () => {
    const forms = priorFormsFromRows({
      employeeName: "Juniper Brandvold",
      rows: [row("ca", "dpoa", "2026-09-21"), row("co", "coaching", "2026-09-02")],
      warningLevels: new Map([["ca", ["verbal"]]]),
    });
    expect(forms.map((form) => form.line)).toEqual([
      "Coaching — signed 09/02/2026",
      "Verbal corrective action — signed 09/21/2026",
    ]);
  });

  it("leaves out drafts, replaced forms, other templates and the form being drafted", () => {
    const forms = priorFormsFromRows({
      employeeName: "Juniper Brandvold",
      excludeInstanceId: "self",
      rows: [
        row("draft", "coaching", "2026-09-01", { status: "draft" }),
        row("revised", "dpoa", "2026-09-03", { status: "revised" }),
        row("exit", "exit", "2026-09-04"),
        row("self", "dpoa", "2026-10-21"),
      ],
      warningLevels: new Map(),
    });
    expect(forms).toEqual([]);
  });

  it("matches the employee's whole name, never part of it", () => {
    const forms = priorFormsFromRows({
      employeeName: "Juniper Brandvold",
      rows: [
        row("other", "coaching", "2026-09-02", { employeeName: "Juniper Smith" }),
        row("same", "coaching", "2026-09-05", { employeeName: "  juniper  BRANDVOLD " }),
      ],
      warningLevels: new Map(),
    });
    expect(forms.map((form) => form.instanceId)).toEqual(["same"]);
  });

  it("names an unticked Corrective Action plainly", () => {
    const forms = priorFormsFromRows({
      employeeName: "Juniper Brandvold",
      rows: [row("ca", "dpoa", "2026-09-21")],
      warningLevels: new Map(),
    });
    expect(forms[0]?.line).toBe("Corrective action — signed 09/21/2026");
  });
});
