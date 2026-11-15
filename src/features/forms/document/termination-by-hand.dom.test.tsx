// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";

import { ResponsiveForm } from "./responsive-form";

/**
 * QA, 15 Nov 2026: "under the type of warning drop down box I can't select Termination." On the form page — a new
 * draft and a revision draft render the same editable form — the Type of Warning's Termination box is a manager's to
 * tick; only a finalized form is read-only.
 */
afterEach(cleanup);

describe("the form page: Termination is ticked by hand", () => {
  it.each([["a new draft"], ["a revision draft"]])("%s: the box is enabled and ticking it reaches the form", () => {
    const onToggle = vi.fn();
    render(<ResponsiveForm document={correctiveActionDocument()} variant={null} values={{ values: {}, checked: { warning_type: ["written"] } }} onToggle={onToggle} />);
    const box = screen.getByRole("checkbox", { name: "Termination" });
    expect(box.hasAttribute("disabled")).toBe(false);
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith("warning_type", "termination");
  });

  it("a finalized form is read-only, as before", () => {
    render(<ResponsiveForm document={correctiveActionDocument()} variant={null} values={{ values: {}, checked: {} }} readOnly />);
    expect(screen.getByRole("checkbox", { name: "Termination" }).hasAttribute("disabled")).toBe(true);
  });
});
