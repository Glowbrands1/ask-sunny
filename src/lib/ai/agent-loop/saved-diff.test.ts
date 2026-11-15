import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fieldStates, mergeSaved, refusedFields, savedDiff } = await import("./saved-diff");
const { doneThisTurn } = await import("./run");

/* PR 3 (rebuild plan): the saved list is the difference between two reads of the form. Invented names only. */
const row = (fieldKey: string, value: string | null, checked: string[] = []) => ({ fieldKey, value, checked });

describe("savedDiff", () => {
  const before = fieldStates([row("observation", "Remy Calder was late."), row("warning_type", null), row("payroll_deduct", null), row("form_date", "2026-11-12")]);
  it("lists a text field, a tick box and a date with before and after", () => {
    const after = fieldStates([row("observation", "Remy Calder was late on 11/12."), row("warning_type", null, ["written"]), row("payroll_deduct", null), row("form_date", "2026-11-13")]);
    expect(savedDiff(before, after)).toEqual([
      { field: "observation", before: "Remy Calder was late.", after: "Remy Calder was late on 11/12." },
      { field: "warning_type", before: "", after: "written" },
      { field: "form_date", before: "2026-11-12", after: "2026-11-13" },
    ]);
  });
  it("lists nothing when nothing changed, and a side effect that really changed (the action plan)", () => {
    expect(savedDiff(before, before)).toEqual([]);
    const withPlan = new Map(before).set("action_plan", "Termination closing.");
    expect(savedDiff(before, withPlan)).toEqual([{ field: "action_plan", before: "", after: "Termination closing." }]);
  });
});

describe("refusedFields", () => {
  const saved = [{ field: "observation", before: "a", after: "b" }];
  it("a field claimed and not changed is refused with the writer's code, else not_saved", () => {
    expect(refusedFields(["observation", "payroll_deduct", "form_date", "form_date"], saved, new Map([["payroll_deduct", "typed_by_manager"]]))).toEqual([
      { field: "payroll_deduct", reason_code: "typed_by_manager" },
      { field: "form_date", reason_code: "not_saved" },
    ]);
  });
});

describe("mergeSaved: edits in a row on one form add up", () => {
  it("keeps the first before and the latest after; another form starts again; a field put back drops out", () => {
    const first = { instanceId: "f1", saved: [{ field: "observation", before: "a", after: "b" }, { field: "form_date", before: "x", after: "y" }] };
    expect(mergeSaved(first, "f1", [{ field: "observation", before: "b", after: "c" }, { field: "form_date", before: "y", after: "x" }])).toEqual([{ field: "observation", before: "a", after: "c" }]);
    expect(mergeSaved(first, "f2", [{ field: "observation", before: "p", after: "q" }])).toEqual([{ field: "observation", before: "p", after: "q" }]);
  });
});

describe("doneThisTurn names the saved fields from the read-back list", () => {
  it("each saved field with its new wording; no values from the input", () => {
    const text = doneThisTurn({ proposal: null, formOpened: null as never, formUpdate: { instanceId: "f1", updated: ["warning_type", "form_date", "observation"], saved: [
      { field: "warning_type", before: "", after: "written" },
      { field: "form_date", before: "2026-11-12", after: "2026-11-13" },
      { field: "observation", before: "a", after: "b" },
    ] } });
    expect(text).toContain("warning type (now \"written\")");
    expect(text).toContain("form date (now \"2026-11-13\")");
    expect(text).toContain("observation (now \"b\")");
  });
  it("falls back to the updated names when there is no list", () => {
    expect(doneThisTurn({ proposal: null, formOpened: null as never, formUpdate: { instanceId: "f1", updated: ["observation"] } })).toContain("observation");
  });
});
