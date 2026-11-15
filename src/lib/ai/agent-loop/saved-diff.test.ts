import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fieldLabel, fieldStates, mergeSaved, readableValue, refusedFields, savedDiff } = await import("./saved-diff");
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
  it("a refusal keeps the writer's code; a field that already held the value is unchanged, not refused", () => {
    expect(refusedFields(["observation", "payroll_deduct", "form_date", "action_plan", "form_date"], saved, new Map([["payroll_deduct", "typed_by_manager"], ["action_plan", "unchanged"]]))).toEqual({
      refused: [{ field: "payroll_deduct", reason_code: "typed_by_manager" }],
      unchanged: ["form_date", "action_plan"],
    });
  });
});

describe("mergeSaved: edits in a row on one form add up", () => {
  it("keeps the first before and the latest after; another form starts again; a field put back is named, not saved", () => {
    const first = { instanceId: "f1", saved: [{ field: "observation", before: "a", after: "b" }, { field: "form_date", before: "x", after: "y" }] };
    expect(mergeSaved(first, "f1", [{ field: "observation", before: "b", after: "c" }, { field: "form_date", before: "y", after: "x" }])).toEqual({
      saved: [{ field: "observation", before: "a", after: "c" }],
      putBack: ["form_date"],
    });
    expect(mergeSaved(first, "f2", [{ field: "observation", before: "p", after: "q" }])).toEqual({ saved: [{ field: "observation", before: "p", after: "q" }], putBack: [] });
  });
});

describe("labels and readable values", () => {
  it("shows a manager's words, not keys or ISO dates", () => {
    expect(fieldLabel("warning_type")).toBe("Type of warning");
    expect(fieldLabel("some_new_field")).toBe("Some new field");
    expect(readableValue("2026-11-13")).toBe("11/13/2026");
    expect(readableValue("written", "warning_type")).toBe("Written");
    expect(readableValue("yes", "payroll_deduct")).toBe("Yes");
    expect(readableValue("b", "observation")).toBe("b");
    expect(readableValue("Remy Calder was late on 11/12.")).toBe("Remy Calder was late on 11/12.");
  });
});

describe("doneThisTurn names the saved fields from the read-back list", () => {
  it("each saved field with its new wording as a manager reads it; a field put back is named as unchanged", () => {
    const text = doneThisTurn({ proposal: null, formOpened: null as never, formUpdate: { instanceId: "f1", updated: ["warning_type", "form_date", "observation"], putBack: ["payroll_deduct"], saved: [
      { field: "warning_type", before: "", after: "written" },
      { field: "form_date", before: "2026-11-12", after: "2026-11-13" },
      { field: "observation", before: "a", after: "b" },
    ] } });
    expect(text).toContain("Type of warning (now Written)");
    expect(text).toContain("Date (now 11/13/2026)");
    expect(text).toContain("Observation (now b)");
    expect(text).toContain("Payroll deduct was changed and put back, so it is unchanged.");
  });
  it("falls back to the updated names when there is no list", () => {
    expect(doneThisTurn({ proposal: null, formOpened: null as never, formUpdate: { instanceId: "f1", updated: ["observation"] } })).toContain("Observation");
  });
});
