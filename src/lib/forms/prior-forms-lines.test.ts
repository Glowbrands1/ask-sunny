import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("PRIOR_ACTIONS_NO_SIGNED_ENABLED (QA, 5 Nov 2026): finalized forms only, and never \"signed\"", () => {
  afterEach(() => vi.unstubAllEnvs());
  const rows = [
    row("final-co", "coaching", "2026-09-02"),
    row("draft-co", "coaching", "2026-10-01", { status: "draft" }),
    row("revised-ca", "dpoa", "2026-10-05", { status: "revised" }),
    row("final-ca", "dpoa", "2026-10-10"),
    row("draft-ca", "dpoa", "2026-10-12", { status: "draft" }),
  ];

  it("on: lists only the finalized forms, each \"finalized <date>\"; drafts and revised forms never", () => {
    vi.stubEnv("PRIOR_ACTIONS_NO_SIGNED_ENABLED", "true");
    const forms = priorFormsFromRows({ employeeName: "Juniper Brandvold", rows, warningLevels: new Map([["final-ca", ["verbal"]]]) });
    expect(forms.map((form) => form.instanceId)).toEqual(["final-co", "final-ca"]);
    expect(forms.map((form) => form.line)).toEqual(["Coaching — finalized 09/02/2026", "Verbal corrective action — finalized 10/10/2026"]);
  });

  it("off: the same finalized forms, \"signed <date>\" as before", () => {
    vi.stubEnv("PRIOR_ACTIONS_NO_SIGNED_ENABLED", "");
    const forms = priorFormsFromRows({ employeeName: "Juniper Brandvold", rows, warningLevels: new Map([["final-ca", ["verbal"]]]) });
    expect(forms.map((form) => form.line)).toEqual(["Coaching — signed 09/02/2026", "Verbal corrective action — signed 10/10/2026"]);
  });
});
