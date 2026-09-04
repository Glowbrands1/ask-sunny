// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { coachingDocument, dmitEppDocument, DMIT_VARIANTS } from "@/lib/forms/library";
import { renderFormPdf } from "@/lib/forms/pdf-render";

import { DocumentSurface } from "./document-surface";

/**
 * THE THREE THINGS THAT MUST BE TRUE OF THE DOCUMENT SURFACE.
 *
 * 1. In EDIT mode the words on the page are editable, and a chip says who fills
 *    every fillable area. That is the whole correction this screen exists for.
 * 2. In FILL mode the chips are gone and the inputs are there instead — a
 *    manager filling a disciplinary record should not be reading editor
 *    markings.
 * 3. THE CHIPS NEVER PRINT. Asserted against the real PDF bytes, not against a
 *    mock, because a chip on a signed record is a defect nobody would think to
 *    go looking for.
 */

const EDITABLE = ["ai", "manager", "employee", "system"] as const;

afterEach(cleanup);

describe("the document in edit mode", () => {
  it("shows the black section bars as text on the page", () => {
    render(
      <DocumentSurface document={coachingDocument()} mode="edit" variant={null} />,
    );
    expect(screen.getByText("Employee Information")).toBeTruthy();
    expect(screen.getByText("Type Of Coaching")).toBeTruthy();
  });

  it("marks every fillable area with who fills it", () => {
    render(
      <DocumentSurface document={coachingDocument()} mode="edit" variant={null} />,
    );
    expect(screen.getAllByText(/AI FILLS/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SIGNED BY HAND/).length).toBe(2);
  });

  it("lets a section heading be retyped on the page, and reports the new text", async () => {
    const user = userEvent.setup();
    const onEditBlock = vi.fn();
    render(
      <DocumentSurface
        document={coachingDocument()}
        mode="edit"
        variant={null}
        onEditBlock={onEditBlock}
      />,
    );

    const heading = screen.getByText("Type Of Coaching");
    await user.click(heading);
    await user.keyboard("!");

    expect(onEditBlock).toHaveBeenCalled();
    const [index, next] = onEditBlock.mock.calls.at(-1)!;
    expect(typeof index).toBe("number");
    expect(next.kind).toBe("section");
  });

  it("shows the acknowledgement wording, so it can be checked and corrected", () => {
    // The reference forms carry this paragraph verbatim and the old settings
    // editor never showed it at all.
    render(
      <DocumentSurface document={coachingDocument()} mode="edit" variant={null} />,
    );
    expect(screen.getByText(/I confirm that my supervisor and I have discussed/)).toBeTruthy();
  });
});

describe("the document in fill mode", () => {
  it("drops the editor chips and puts real inputs in their place", () => {
    render(
      <DocumentSurface
        document={coachingDocument()}
        mode="fill"
        variant={null}
        editable={EDITABLE}
        values={{ values: {}, checked: {}, filledBy: {} }}
      />,
    );
    expect(screen.queryByText(/AI FILLS/)).toBeNull();
    expect(screen.queryByText(/SIGNED BY HAND/)).toBeNull();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
  });

  it("leaves signature lines with nothing to type into", () => {
    render(
      <DocumentSurface
        document={coachingDocument()}
        mode="fill"
        variant={null}
        editable={EDITABLE}
        values={{ values: {}, checked: {}, filledBy: {} }}
      />,
    );
    // A signature block has no field key at all, so there is no input to find.
    expect(screen.queryByLabelText(/Employee Signature/)).toBeNull();
    expect(screen.getByText("Employee Signature")).toBeTruthy();
  });

  it("ticks a checkbox through the handler rather than holding its own state", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <DocumentSurface
        document={coachingDocument()}
        mode="fill"
        variant={null}
        editable={EDITABLE}
        values={{ values: {}, checked: {}, filledBy: {} }}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByLabelText("Under Performance"));
    expect(onToggle).toHaveBeenCalledWith("coaching_type", "under_performance");
  });
});

describe("one document, two readings", () => {
  it("resolves {{role}} from the chosen reading", () => {
    const tsd = DMIT_VARIANTS.find((entry) => entry.key === "tsd")!;
    render(
      <DocumentSurface document={dmitEppDocument()} mode="edit" variant={tsd} />,
    );
    // The stored text is "{{role}}", so seeing the resolved role proves the
    // interpolation runs on the page and not only in the PDF.
    expect(screen.queryByText(/\{\{role\}\}/)).toBeNull();
    expect(screen.getAllByText(new RegExp(tsd.role)).length).toBeGreaterThan(0);
  });

  it("splits the DMIT EPP onto the sheets its page breaks ask for", () => {
    const tsd = DMIT_VARIANTS.find((entry) => entry.key === "tsd")!;
    const { container } = render(
      <DocumentSurface document={dmitEppDocument()} mode="edit" variant={tsd} />,
    );
    const breaks = dmitEppDocument().blocks.filter((block) => block.kind === "page_break").length;
    expect(container.querySelectorAll("[data-form-page]").length).toBe(breaks + 1);
  });
});

describe("the chips never print", () => {
  it("puts no responsibility chip text into the generated PDF", () => {
    const bytes = renderFormPdf(
      coachingDocument(),
      null,
      { values: {}, checked: {} },
      {
        templateName: "Coaching Form",
        templateVersion: 1,
        employeeName: "Jordan Vance (test)",
        formDate: "2026-09-04",
        status: "draft",
      },
    );
    const text = new TextDecoder("latin1").decode(bytes);

    // The PDF's content streams are uncompressed by this renderer, so the words
    // it draws are literally in the bytes — which is what makes this checkable.
    for (const chip of ["AI FILLS", "SIGNED BY HAND", "FILLED BY HAND", "MANAGER", "EMPLOYEE"]) {
      expect(text.includes(chip), `"${chip}" reached the PDF`).toBe(false);
    }
    // A control: wording that SHOULD print does.
    expect(text.includes("Employee Information")).toBe(true);
  });
});
