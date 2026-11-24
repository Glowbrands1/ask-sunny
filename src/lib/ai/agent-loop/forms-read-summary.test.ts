import { describe, expect, it } from "vitest";

import { formsReadSummary } from "./run";

/**
 * QA, 23 Nov 2026 (the live duplicate exit form): a find_past_forms read said "no exit form on file" and what it returned
 * could not be seen afterwards. Each find_past_forms step on the trace now says, value-free: the forms listed per form
 * kind, the counted total, and the path the read took. Form names and numbers only, never a person, a date or text.
 */
describe("formsReadSummary", () => {
  it("counts the listed forms per kind, with the total and the listed path", () => {
    const summary = formsReadSummary({
      forms: [
        { form: "Resignation/Exit Form", employee: "Invented Person", date: "11/20/2026" },
        { form: "Corrective Action Form", employee: "Invented Person", date: "11/16/2026" },
        { form: "Corrective Action Form", employee: "Invented Person", date: "11/11/2026" },
      ],
      counts: { total: 3 },
    } as never);
    expect(summary).toEqual({ path: "listed", by_kind: { "Resignation/Exit Form": 1, "Corrective Action Form": 2 }, total: 3 });
    expect(JSON.stringify(summary)).not.toMatch(/Invented|11\/20/);
  });

  it("an error is the error path, with its reason_code", () => {
    expect(formsReadSummary({ reason_code: "read_failed", error: "Form Monitoring could not be read just now." } as never)).toEqual({ path: "error:read_failed", by_kind: {} });
  });

  it("an empty list is none; a no-forms path is named by its own key", () => {
    expect(formsReadSummary({ forms: [], note: "None on file." } as never)).toEqual({ path: "none", by_kind: {} });
    expect(formsReadSummary({ forms: [], names_on_file: ["Invented One", "Invented Two"], note: "…" } as never)).toEqual({ path: "names_on_file", by_kind: {} });
  });
});
