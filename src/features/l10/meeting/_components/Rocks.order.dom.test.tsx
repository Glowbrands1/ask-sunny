// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Rock } from "@/features/l10/lib/types";
import { Rocks } from "./Rocks";

/* The owner's request (13 Nov 2026): "Add new rock" sits at the TOP of Rock Review, before the first rock section. */
const rocks: Rock[] = [
  { id: "k1", title: "Company rock", owner: "Company", status: "on-track", milestones: [] },
  { id: "k2", title: "Pat's rock", owner: "Pat Example", status: "off-track", milestones: [] },
];

describe("Rock Review: the add form comes first", () => {
  it("renders before the first rock section, and adding still works the same way", () => {
    const onChange = vi.fn();
    render(<Rocks rocks={rocks} onChange={onChange} people={["Pat Example"]} today="2026-11-13" />);
    const title = screen.getByLabelText("New rock title");
    const firstSection = screen.getByRole("region", { name: "Company Rocks" });
    expect(title.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Add new rock").compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Same behaviour: the title is required, the new rock is added at the end with the chosen owner and due date.
    expect((screen.getByRole("button", { name: "Add rock" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(title, { target: { value: "Open the new office" } });
    fireEvent.change(screen.getByLabelText("New rock owner"), { target: { value: "Pat Example" } });
    fireEvent.change(screen.getByLabelText("New rock due date"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rock" }));
    const next = onChange.mock.calls[0][0] as Rock[];
    expect(next.slice(0, 2)).toEqual(rocks);
    expect(next[2]).toMatchObject({ title: "Open the new office", owner: "Pat Example", status: "on-track", dueDate: "2026-12-31" });
    expect((title as HTMLInputElement).value).toBe("");
  });

  it("an empty section points up to the form", () => {
    render(<Rocks rocks={[]} onChange={() => {}} people={[]} today="2026-11-13" />);
    expect(document.body.textContent).toContain("No company rocks yet. Add one above with owner “Company”.");
  });
});
