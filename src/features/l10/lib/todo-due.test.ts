import { describe, expect, it } from "vitest";

import { calendarDate, todoDueLabel, withTodoDueDate } from "./todo-due";

/* Pau, 20 Nov 2026: a To-Do's due date, shown as "Due Fri, Nov 27"; none keeps "Next wk". */
describe("a To-Do's due date", () => {
  it("reads a calendar day, never shifted by a clock or a time zone", () => {
    expect(todoDueLabel({ dueDate: "2026-11-27", due: "2026-11-27" })).toBe("Due Fri, Nov 27");
    expect(todoDueLabel({ dueDate: "2026-12-31" })).toBe("Due Thu, Dec 31");
    expect(todoDueLabel({ due: "Next wk" })).toBe("Next wk");
    expect(calendarDate("2026-02-31")).toBeNull();
  });

  it("sets a date, or clears it back to \"Next wk\"", () => {
    const todo = { id: "t", text: "x", owner: "—", due: "Next wk", done: false };
    expect(withTodoDueDate(todo, "2026-11-27")).toEqual({ ...todo, due: "2026-11-27", dueDate: "2026-11-27" });
    const cleared = withTodoDueDate({ ...todo, due: "2026-11-27", dueDate: "2026-11-27" }, "");
    expect(cleared).toEqual(todo);
    expect("dueDate" in cleared).toBe(false);
  });
});
