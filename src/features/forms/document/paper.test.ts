import { describe, expect, it } from "vitest";

import { PAGE, PAGE_PX, px } from "@/lib/forms/paper";
import type { FormBlock } from "@/lib/forms/document";

import { paginate } from "./paper";

/**
 * THE PAGE SPLIT, and the promise it makes.
 *
 * The editor promises exactly one thing about pagination: the breaks you PUT in
 * the document are the breaks you get, in the editor and in the PDF. It does
 * not promise to predict where the printer will run out of room, because the
 * PDF wraps with its own font metrics and a prediction that disagreed would be
 * worse than no prediction.
 */

const block = (kind: FormBlock["kind"]): FormBlock =>
  kind === "page_break"
    ? { kind: "page_break" }
    : { kind: "section", label: kind };

describe("splitting a document into sheets", () => {
  it("puts everything on one sheet when there are no breaks", () => {
    const pages = paginate([block("section"), block("section")]);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.blocks).toHaveLength(2);
    expect(pages[0]!.breakIndex).toBeNull();
  });

  it("starts a new sheet at every break, and names the break that closed each", () => {
    const pages = paginate([
      block("section"),
      block("page_break"),
      block("section"),
      block("page_break"),
      block("section"),
    ]);
    expect(pages).toHaveLength(3);
    expect(pages[0]!.breakIndex).toBe(1);
    expect(pages[1]!.breakIndex).toBe(3);
    expect(pages[2]!.breakIndex).toBeNull();
  });

  it("keeps a trailing break's empty sheet rather than swallowing it", () => {
    // An administrator who adds a break at the end has asked for a blank page.
    // Silently dropping it makes the control look broken.
    const pages = paginate([block("section"), block("page_break")]);
    expect(pages).toHaveLength(2);
    expect(pages[1]!.blocks).toHaveLength(0);
  });

  it("never leaves a page_break inside a sheet's blocks", () => {
    // The seam is drawn between sheets. A break rendered inside one would print
    // as an empty gap and could not be dragged anywhere useful.
    const pages = paginate([block("section"), block("page_break"), block("section")]);
    for (const page of pages) {
      expect(page.blocks.some((entry) => entry.block.kind === "page_break")).toBe(false);
    }
  });
});

describe("the paper the editor and the PDF share", () => {
  it("is US Letter, in points, exactly as the PDF is drawn", () => {
    expect(PAGE.width).toBe(612);
    expect(PAGE.height).toBe(792);
  });

  it("converts to CSS pixels at 96dpi, so a Letter page is 816 x 1056", () => {
    // If this drifts, the on-screen page stops being the printed page and the
    // whole point of editing on paper is gone.
    expect(PAGE_PX.width).toBe(816);
    expect(PAGE_PX.height).toBe(1056);
    expect(px(54)).toBe(72);
  });
});
