// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Popover, PopoverContent, PopoverTrigger } from "./overlays";

/**
 * OPENING OR CLOSING AN OVERLAY MUST NOT MOVE THE VIEWPORT.
 *
 * This file exists because of a misdiagnosis worth not repeating, and one real
 * gap found while disproving it. A browser run appeared to show the page
 * jumping to the top whenever a filter dropdown opened while scrolled down.
 * That cause turned out to be the TEST HARNESS:
 * Playwright's `locator.click()` scrolls its target into view first, and the
 * filter bar is `position: sticky` — scrolling a sticky element into view aims
 * at its LAYOUT position, which is the top of the document, not the place it is
 * painted. Opening the same menu with a plain DOM click or with the keyboard
 * held the scroll position exactly (900 -> 900 both ways; 900 -> 0 only under
 * `locator.click()`).
 *
 * So the OPEN path needed nothing: Radix's focus scope already focuses with
 * `{ preventScroll: true }`. The CLOSE path did — Radix returns focus to the
 * trigger with a bare `focus()`, which asks the browser to scroll that element
 * into view. On the reporting filter bar it is harmless, because the bar is
 * sticky and the trigger is always on screen (measured: dismiss at scroll 900,
 * still 900). Anywhere the trigger can scroll out of view it would move the
 * page, so `PopoverContent` now restores focus itself with `preventScroll`.
 *
 * The rest is behaviour worth PINNING, because two plausible "fixes" would each
 * break something real:
 *
 *   Preventing `onOpenAutoFocus` outright would stop the panel receiving focus,
 *   which is how a keyboard user reaches the options at all.
 *
 *   Focusing something without `preventScroll` — in an app handler, or through
 *   a dependency upgrade — reintroduces the jump for real, on the sticky bar
 *   where every filter control lives.
 *
 * These tests assert the mechanism rather than the pixels: jsdom has no layout
 * and cannot scroll, so a scroll assertion here would pass no matter what. They
 * check that focus lands inside the panel, that every focus call made while
 * opening passes `preventScroll`, and that nothing asks to be scrolled into
 * view. The viewport itself is verified in a browser, by clicking the way a
 * person does.
 */

/** jsdom lacks the layout APIs Radix's positioning depends on. */
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { value: () => false, writable: true });
    }
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Menu() {
  return (
    <Popover>
      <PopoverTrigger>Metric</PopoverTrigger>
      <PopoverContent>
        <button type="button">Total Revenue</button>
        <button type="button">EFT Revenue</button>
      </PopoverContent>
    </Popover>
  );
}

/** Records every focus call and the options it was given. */
function watchFocus() {
  const calls: { el: string; preventScroll: boolean }[] = [];
  const original = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    calls.push({
      el: `${this.tagName}:${(this.textContent ?? "").trim().slice(0, 20)}`,
      preventScroll: options?.preventScroll === true,
    });
    return original.call(this, options);
  });
  return calls;
}

describe("opening a shared popover", () => {
  it("moves focus into the panel, so a keyboard user can reach the options", async () => {
    const user = userEvent.setup();
    render(<Menu />);

    await user.click(screen.getByText("Metric"));
    await waitFor(() => expect(screen.getByText("Total Revenue")).toBeTruthy());

    // The panel, or something inside it, holds focus. Anything else means the
    // options are unreachable without a mouse.
    const panel = screen.getByText("Total Revenue").closest("[data-radix-popper-content-wrapper]")
      ?? screen.getByText("Total Revenue").parentElement;
    expect(panel?.contains(document.activeElement)).toBe(true);
  });

  it("focuses with preventScroll, which is what keeps the viewport still", async () => {
    /*
     * THE ASSERTION THAT MATTERS. The filter bar is sticky, so a focus call
     * without `preventScroll` scrolls the document to the bar's layout
     * position — the top — and throws a reader halfway down the page back to
     * the header. Radix's focus scope passes the flag; this fails if an app
     * handler or a dependency upgrade stops doing so.
     */
    const calls = watchFocus();
    const user = userEvent.setup();
    render(<Menu />);

    await user.click(screen.getByText("Metric"));
    await waitFor(() => expect(screen.getByText("Total Revenue")).toBeTruthy());

    /*
     * The TRIGGER's own focus is excluded, and that is not a loophole:
     * `userEvent.click` calls `.focus()` on what it clicks to imitate a real
     * click, whereas a real mouse focuses natively and never goes through this
     * method. What is being tested is the focus the OVERLAY performs — the
     * move into the panel — so the assertion looks at everything else.
     */
    const overlayCalls = calls.filter((call) => !call.el.includes("Metric"));
    const scrollingCalls = overlayCalls.filter((call) => !call.preventScroll);

    expect(overlayCalls.length, "the overlay focused nothing at all").toBeGreaterThan(0);
    expect(scrollingCalls, `focused without preventScroll: ${scrollingCalls.map((c) => c.el).join(", ")}`)
      .toEqual([]);
  });

  it("asks nothing to be scrolled into view", async () => {
    const intoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const scrollTo = vi.fn();
    const originalScrollTo = window.scrollTo;
    Object.defineProperty(window, "scrollTo", { value: scrollTo, writable: true });

    const user = userEvent.setup();
    render(<Menu />);
    await user.click(screen.getByText("Metric"));
    await waitFor(() => expect(screen.getByText("Total Revenue")).toBeTruthy());

    expect(intoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, "scrollTo", { value: originalScrollTo, writable: true });
  });

  it("returns focus to the trigger on Escape, without asking to scroll", async () => {
    /*
     * THE GAP THIS FILE CLOSED. Radix's own close-refocus omits
     * `preventScroll`; `PopoverContent` intercepts it and restores focus with
     * the flag set. Both halves are asserted, because dropping either one is a
     * regression: no focus at all breaks the keyboard, and focus without the
     * flag scrolls the page wherever the trigger is not sticky.
     */
    const user = userEvent.setup();
    render(<Menu />);
    await user.click(screen.getByText("Metric"));
    await waitFor(() => expect(screen.getByText("Total Revenue")).toBeTruthy());

    const trigger = screen.getByText("Metric");
    const calls = watchFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Total Revenue")).toBeNull());

    /*
     * IDENTITY, not text. An earlier version of this assertion compared
     * `document.activeElement?.textContent` to "Metric" — and passed while
     * focus had actually been dumped on `<body>`, whose textContent begins
     * with the trigger's label. Comparing the element itself cannot be fooled.
     */
    expect(document.activeElement).toBe(trigger);

    const scrolling = calls.filter((call) => !call.preventScroll);
    expect(scrolling, `focused without preventScroll: ${scrolling.map((c) => c.el).join(", ")}`)
      .toEqual([]);
    expect(calls.length, "nothing restored focus at all").toBeGreaterThan(0);
  });
});

describe("the shared overlay must not opt out of focus management", () => {
  it("leaves the OPENING focus to Radix and hardens only the closing one", async () => {
    /*
     * The tempting "fix" for the phantom jump was to cancel the panel's
     * auto-focus. That would have traded an imaginary scroll bug for a real
     * accessibility one: the panel is how a keyboard user reaches the options.
     * So the open path stays untouched and the close path — the one Radix
     * leaves scrolling — is the only thing intercepted.
     */
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/components/ui/overlays.tsx", "utf8"),
    );
    const popover = source.slice(source.indexOf("export const PopoverContent"));
    const code = popover
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    /*
     * `onOpenAutoFocus` may be present — it is how the trigger is identified —
     * but it must stay READ-ONLY. The moment it prevents the default, the panel
     * stops receiving focus and the options become mouse-only.
     */
    const openHandler = code.slice(code.indexOf("onOpenAutoFocus"), code.indexOf("onCloseAutoFocus"));
    expect(openHandler).not.toContain("preventDefault");
    expect(code).toContain("onCloseAutoFocus");
    // In the CODE, not in the prose above it — the comments are stripped first,
    // which is why an earlier version of this guard missed a dropped flag.
    expect(code).toContain("focus({ preventScroll: true })");
    // And the trigger is resolved from the DOM at close time rather than
    // remembered at mount, which captured <body>.
    expect(code).toContain("aria-controls");
  });
});
