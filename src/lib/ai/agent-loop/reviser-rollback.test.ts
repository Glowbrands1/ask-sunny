import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const writes: { values: Record<string, string>; checked: Record<string, string[]>; cleared: readonly string[] }[] = [];
const subjectLines: string[] = [];
vi.mock("@/lib/forms/form-write", () => ({
  writeRevisionEdits: vi.fn(async (_id: string, draft: { values: Record<string, string>; checked: Record<string, string[]> }, cleared: readonly string[]) => {
    writes.push({ ...draft, cleared });
    return { accepted: draft, cleared, rejected: [] };
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ update: (row: { employee_name: string }) => ({ eq: async () => (subjectLines.push(row.employee_name), { error: null }) }) }) }),
}));
vi.mock("@/lib/config/chat-quality-flags", async (original) => ({ ...(await original<object>()), formEditSingleWriterEnabled: () => true }));

const { rollBackRevision } = await import("./tools");

/*
 * QA's re-review of PR 1a, fix 2: a reviser that changed the employee's name has its WHOLE revision rolled back:
 * every field it wrote goes back to its value before the turn (an empty one is cleared), never a partial save.
 * People invented.
 */
describe("rollBackRevision", () => {
  it("puts back every field the revision wrote, and the subject line", async () => {
    const before = {
      instance: { employeeName: "Remy Calder" },
      values: [
        { fieldKey: "employee_name", value: "Remy Calder" },
        { fieldKey: "form_date", value: "2026-11-14" },
        { fieldKey: "observation", value: "She was late to her shift on 11/14." },
        { fieldKey: "warning_type", value: null, checked: ["verbal"] },
        { fieldKey: "other_text", value: "" },
      ],
    };
    const notRestored = await rollBackRevision("form-1", before, ["employee_name", "form_date", "warning_type", "other_text"], "manager-1");
    expect(notRestored).toEqual([]);
    expect(writes.at(-1)).toEqual({
      values: { employee_name: "Remy Calder", form_date: "2026-11-14" },
      checked: { warning_type: ["verbal"] },
      cleared: ["other_text"],
    });
    expect(subjectLines.at(-1)).toBe("Remy Calder");
  });
});
