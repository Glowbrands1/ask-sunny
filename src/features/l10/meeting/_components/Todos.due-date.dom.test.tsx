// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "@/features/l10/lib/types";
import { Todos } from "./Todos";

/*
 * Pau, 20 Nov 2026 ("pls help add due date for both sunny and bubble"), from a user's question: "I added my own To-Do's in
 * the Ask Sunny L10, but I'm unable to include a Due Date. It simply states 'Next wk'." The DM L10 (Bloom layout) had no
 * due-date box, and neither layout could change a date after adding. Invented names only.
 */
const PEOPLE = ["Pat Example", "Sam Sample"];
const TODOS: Todo[] = [
  { id: "t1", text: "Call the landlord", owner: "Pat Example", due: "Next wk", done: false },
  { id: "t2", text: "Order shelving", owner: "Sam Sample", due: "2026-11-27", dueDate: "2026-11-27", done: false },
];

afterEach(cleanup);

describe("To-dos: a due date when adding and editing", () => {
  it("DM L10 (Bloom layout): adding with a due date saves it and shows it", () => {
    const onChange = vi.fn();
    render(<Todos bloom todos={[]} onChange={onChange} people={PEOPLE} today="2026-11-20" />);
    fireEvent.change(screen.getByLabelText("New to-do"), { target: { value: "Send the schedule" } });
    fireEvent.change(screen.getByLabelText("To-do due date"), { target: { value: "2026-11-27" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ text: "Send the schedule", dueDate: "2026-11-27", done: false });
  });

  it("DM L10 (Bloom layout): no date keeps \"Next wk\", and the details change the date", () => {
    const onChange = vi.fn();
    render(<Todos bloom todos={TODOS} onChange={onChange} people={PEOPLE} today="2026-11-20" />);
    expect(screen.getAllByTestId("todo-due").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Next wk", "11-27-2026"]));
    fireEvent.click(screen.getByRole("button", { name: "Show details: Call the landlord" }));
    fireEvent.change(screen.getByLabelText("Due date: Call the landlord"), { target: { value: "2026-12-02" } });
    const next = onChange.mock.calls.at(-1)![0] as Todo[];
    expect(next.find((todo) => todo.id === "t1")).toMatchObject({ dueDate: "2026-12-02" });
    expect(next.find((todo) => todo.id === "t2")).toEqual(TODOS[1]);
  });

  it("GM L10 (list layout): the date reads \"Due Fri, Nov 27\", can be changed, and cleared back to \"Next wk\"", () => {
    const onChange = vi.fn();
    render(<Todos todos={TODOS} onChange={onChange} people={PEOPLE} today="2026-11-20" />);
    expect(screen.getByRole("button", { name: "Change due date: Order shelving" }).textContent).toBe("Due Fri, Nov 27");
    expect(screen.getByRole("button", { name: "Change due date: Call the landlord" }).textContent).toBe("Next wk");
    fireEvent.click(screen.getByRole("button", { name: "Change due date: Call the landlord" }));
    fireEvent.change(screen.getByLabelText("Due date: Call the landlord"), { target: { value: "2026-12-04" } });
    expect((onChange.mock.calls.at(-1)![0] as Todo[]).find((todo) => todo.id === "t1")).toMatchObject({ dueDate: "2026-12-04" });
    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Change due date: Order shelving" }));
    fireEvent.change(screen.getByLabelText("Due date: Order shelving"), { target: { value: "" } });
    const cleared = (onChange.mock.calls.at(-1)![0] as Todo[]).find((todo) => todo.id === "t2")!;
    expect(cleared.dueDate).toBeUndefined();
    expect(cleared.due).toBe("Next wk");
  });
});
