// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/overlays";
import { ANSWER_MODE_HELPER, MANAGER_NOTE, MANAGER_NOTE_SHORT } from "@/data/demo/chat";
import { Composer } from "./composer";
import type { AnswerMode } from "@/types";

/**
 * ============================================================================
 * THE COMPOSER GIVES THE ANSWER ITS ROOM BACK
 * ============================================================================
 *
 * THE FEEDBACK THESE PIN. On a laptop the box for asking took comparable height
 * to the space for the answer. Four things were responsible, and the text field
 * was not one of them: a full-width answer-mode row, a helper sentence under it
 * restating the three labels, three DISABLED controls plus a "Coming later"
 * label, and the manager note at three wrapped lines.
 *
 * So these assert both halves — that what was removed is gone, and that
 * everything it was doing still works. A composer that dropped answer modes to
 * save space would pass a height test and fail the product.
 */

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof Composer>> = {},
) {
  const props = {
    value: "",
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    mode: "standard" as AnswerMode,
    onModeChange: vi.fn(),
    busy: false,
    ...overrides,
  };
  const view = render(
    <TooltipProvider>
      <Composer {...props} />
    </TooltipProvider>,
  );
  return { ...view, props };
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText("Ask Sunny a question") as HTMLTextAreaElement;
}

afterEach(cleanup);

/* ------------------------------------------------------ the text field --- */

describe("the text field is untouched", () => {
  it("starts as a single row", () => {
    // A. It was already correct. The fix was never to replace it with a
    // fixed-height box.
    renderComposer();
    expect(textarea().rows).toBe(1);
  });

  it("keeps the cap-and-scroll contract that lets it grow", () => {
    /*
     * B. jsdom reports every scrollHeight as 0, so it cannot prove the field
     * actually grows — real growth is Preview QA. What it CAN prove is that the
     * auto-size effect still runs and writes an explicit height, and that the
     * classes bounding that growth are intact. Asserting a pixel value here
     * would be asserting jsdom's zero.
     */
    renderComposer({ value: "a\nb\nc\nd" });
    const node = textarea();

    expect(node.style.height).not.toBe("");
    expect(node.className).toContain("resize-none");
    expect(node.className).toContain("max-h-50");
    expect(node.className).toContain("scroll-slim");
  });

  it("sends on Enter", () => {
    // C. The most-used interaction in the app.
    const { props } = renderComposer({ value: "how much PTO?" });
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not send on Shift+Enter", () => {
    const { props } = renderComposer({ value: "how much PTO?" });
    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("does not send an empty question, or one while a turn is in flight", () => {
    const empty = renderComposer({ value: "   " });
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(empty.props.onSubmit).not.toHaveBeenCalled();
    cleanup();

    const busy = renderComposer({ value: "a question", busy: true });
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(busy.props.onSubmit).not.toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------- the modes --- */

describe("answer modes survive the compaction", () => {
  it("offers all three, by name", () => {
    // E. Named options, not colour-coded segments — readable by a screen
    // reader and by somebody who cannot distinguish the active fill.
    renderComposer();
    for (const label of ["Quick", "Standard", "Detailed"]) {
      expect(screen.getByRole("radio", { name: label })).toBeTruthy();
    }
  });

  it("exposes the group under an accessible name", () => {
    renderComposer();
    expect(screen.getByRole("radiogroup", { name: "Answer mode" })).toBeTruthy();
  });

  it("marks the current mode as chosen rather than only styling it", () => {
    renderComposer({ mode: "detailed" });
    expect(screen.getByRole("radio", { name: "Detailed" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Quick" }).getAttribute("aria-checked")).toBe("false");
  });

  it("still changes the mode when one is chosen", () => {
    // D. The control moved. Its behaviour did not.
    const { props } = renderComposer({ mode: "standard" });
    fireEvent.click(screen.getByRole("radio", { name: "Detailed" }));
    expect(props.onModeChange).toHaveBeenCalledWith("detailed");
  });

  it("shares one line with the disclaimer rather than taking a row of its own", () => {
    /*
     * THE STRUCTURAL HALF OF THE FIX, RE-ANCHORED. This required the mode group
     * and the send button to share a container, which was how the dock removed
     * a whole row of idle height.
     *
     * The Marquee Chat artifact arranges the same 110px dock differently — item
     * 8: "One-line input, the mode selector and one line of disclaimer beside
     * it." So the input row holds the sun, the field and the send, and the modes
     * sit on the row BELOW it next to the standing note.
     *
     * The property that matters is unchanged and is what is checked: the modes
     * do not get a row to themselves. They share one with the disclaimer, and
     * there are exactly two rows in the dock rather than the four blocks the
     * original feedback was about.
     */
    renderComposer();
    const group = screen.getByRole("radiogroup", { name: "Answer mode" });
    const send = screen.getByRole("button", { name: "Send message" });

    // The modes are NOT in the input row — that row is the field and the send.
    expect(send.parentElement?.contains(group)).toBe(false);

    // They share their row with the note, which is the line that used to be a
    // separate block beneath everything.
    const row = group.parentElement?.parentElement;
    expect(row?.textContent).toContain(MANAGER_NOTE_SHORT);

    // And that row is a sibling of the input row, not a third stacked block.
    expect(row?.parentElement).toBe(send.parentElement?.parentElement);
  });
});

/* ------------------------------------------------- what no longer shows --- */

describe("nothing dead is rendered", () => {
  it("shows no attachment, image or voice control", () => {
    // F. They were honest and disabled. A manager still reads three controls
    // that do not work as broken product.
    renderComposer();
    for (const name of [/attach/i, /image/i, /voice/i, /microphone/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("shows no 'Coming later' label", () => {
    const { container } = renderComposer();
    expect(container.textContent).not.toMatch(/coming later/i);
  });

  it("renders no disabled control at all, once there is something to send", () => {
    /*
     * Nor were the three replaced with a quieter dead control. Rendered with a
     * question in the field, because Send's own disabled state is legitimate
     * and is asserted below — the check here is that NOTHING ELSE is inert.
     */
    const { container } = renderComposer({ value: "how much PTO?" });
    expect(container.querySelectorAll("button[disabled]")).toHaveLength(0);
  });

  it("still disables Send with nothing to send", () => {
    // The one legitimate disabled state, which must not have been swept up.
    renderComposer({ value: "" });
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("the explanatory prose no longer occupies a permanent row", () => {
  it("does not render the mode helper sentences persistently", () => {
    // G. Three sentences restating three labels, on their own line, always.
    const { container } = renderComposer();
    for (const mode of ["quick", "standard", "detailed"] as AnswerMode[]) {
      expect(container.textContent).not.toContain(ANSWER_MODE_HELPER[mode]);
    }
  });

  it("does not render the full manager note as a standing block", () => {
    const { container } = renderComposer();
    expect(container.textContent).not.toContain(MANAGER_NOTE);
  });

  it("keeps the note's meaning visible in one line", () => {
    /*
     * H. The visible line is the first clause of the note VERBATIM, not a
     * paraphrase — the sentence that carries the meaning survives at full
     * strength, and only the verification-channel detail moved behind the
     * affordance.
     */
    const { container } = renderComposer();
    expect(container.textContent).toContain(MANAGER_NOTE_SHORT);
    expect(MANAGER_NOTE.startsWith(MANAGER_NOTE_SHORT)).toBe(true);
  });

  it("keeps the full explanation reachable from a real, focusable control", () => {
    /*
     * A tooltip hung on static text is unreachable by keyboard and by touch,
     * which would have removed the explanation rather than moved it. This is a
     * button, so it is tabbable and it has a name.
     *
     * Whether the tooltip PANEL paints is Radix's business and Preview QA's —
     * what is asserted here is that the affordance exists and is operable.
     */
    renderComposer();
    const info = screen.getByRole("button", {
      name: "About answer modes and Sunny's limits",
    });
    expect(info.tagName).toBe("BUTTON");
    expect(info.hasAttribute("disabled")).toBe(false);
  });
});
