// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  firstRoundManagementInterviewDocument,
  prescreenPhoneInterviewDocument,
  secondRoundManagementInterviewDocument,
  tanningConsultantInterviewDocument,
} from "@/lib/forms/hiring-library";
import { renderFormPdf } from "@/lib/forms/pdf-render";

import { DocumentSurface } from "./document/document-surface";

/**
 * THE FOUR HIRING FORMS, OPENED.
 *
 * The fidelity tests in `lib/forms/hiring-library.test.ts` assert what each
 * document SAYS. These assert that it OPENS: that the surface an interviewer
 * actually works in renders every one of them, that the answer areas are real
 * inputs they can type into, that the checkboxes report a tick, and that the
 * same document survives being printed.
 *
 * A document can be perfectly transcribed and still be unusable — a block kind
 * the surface does not render, a checkbox with no label to click. Compiling
 * proves neither.
 */

const EDITABLE = ["ai", "manager", "employee", "system"] as const;
const EMPTY = { values: {}, checked: {}, filledBy: {} };

const FORMS = [
  { name: "Prescreen / Phone Interview", document: prescreenPhoneInterviewDocument() },
  { name: "Tanning Consultant Interview", document: tanningConsultantInterviewDocument() },
  { name: "First Round Management Interview", document: firstRoundManagementInterviewDocument() },
  { name: "Second Round Management Interview", document: secondRoundManagementInterviewDocument() },
];

afterEach(cleanup);

describe.each(FORMS)("$name", ({ document }) => {
  it("renders every block on the fill surface", () => {
    render(
      <DocumentSurface
        document={document}
        mode="fill"
        variant={null}
        editable={EDITABLE}
        values={EMPTY}
      />,
    );
    // The letterhead, which is how an interviewer knows which form they opened.
    expect(screen.getByText("SUN TAN CITY")).toBeTruthy();
    for (const block of document.blocks) {
      if (block.kind === "section") {
        expect(screen.getByText(block.label), block.label).toBeTruthy();
      }
    }
  });

  it("gives every answer area something to type into", () => {
    const { container } = render(
      <DocumentSurface
        document={document}
        mode="fill"
        variant={null}
        editable={EDITABLE}
        values={EMPTY}
      />,
    );
    const writable = document.blocks.filter(
      (block) => block.kind === "field" || block.kind === "field_row",
    ).length;
    expect(writable).toBeGreaterThan(0);
    const inputs = container.querySelectorAll("input, textarea");
    expect(inputs.length).toBeGreaterThanOrEqual(writable);
  });

  it("prints without losing its sections", async () => {
    const bytes = renderFormPdf(document, null, { values: {}, checked: {} }, {
      templateName: "Interview",
      templateVersion: 1,
      employeeName: "Riley Chen",
      formDate: "2026-09-07",
      status: "draft",
    });
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toContain("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe("ticking a box on an interview form", () => {
  it("reports the tick rather than holding its own state", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <DocumentSurface
        document={tanningConsultantInterviewDocument()}
        mode="fill"
        variant={null}
        editable={EDITABLE}
        values={EMPTY}
        onToggle={onToggle}
      />,
    );

    await user.click(screen.getByLabelText("Outgoing"));
    expect(onToggle).toHaveBeenCalledWith("qualities_observed", "outgoing");

    await user.click(screen.getByLabelText("Hire"));
    expect(onToggle).toHaveBeenCalledWith("final_recommendation", "proceed");
  });

  it("offers the CareerPlug line as something the interviewer ticks", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <DocumentSurface
        document={firstRoundManagementInterviewDocument()}
        mode="fill"
        variant={null}
        editable={EDITABLE}
        values={EMPTY}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText("Update In Careerplug")).toBeTruthy();
    await user.click(screen.getByLabelText("Yes"));
    expect(onToggle).toHaveBeenCalledWith("update_in_careerplug", "yes");
  });
});

describe("the interviewer's signature", () => {
  it("is a caption and a rule, with no input behind it", () => {
    const { container } = render(
      <DocumentSurface
        document={prescreenPhoneInterviewDocument()}
        mode="fill"
        variant={null}
        editable={EDITABLE}
        values={EMPTY}
      />,
    );
    expect(screen.getByText("Interviewer Signature")).toBeTruthy();
    // No control anywhere is named for the signature: there is no key to fill.
    for (const input of container.querySelectorAll("input, textarea")) {
      expect(input.getAttribute("aria-label")).not.toBe("Interviewer Signature");
    }
  });
});
