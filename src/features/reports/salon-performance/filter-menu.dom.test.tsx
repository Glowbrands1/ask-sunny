// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MultiSelectMenu, SingleSelectMenu } from "./filter-menu";

/**
 * THE FILTER MENUS MUST ACTUALLY OPEN.
 *
 * This file exists because of a specific shipped defect. `PopoverTrigger asChild`
 * renders a Radix `Slot`, which clones its child and passes it the trigger's
 * behaviour — `onClick`, `type`, `aria-haspopup`, `aria-expanded`, `data-state` —
 * along with a ref used as the popover's anchor. The trigger component took only
 * its own named props and spread nothing onto the `<button>`, so every one of
 * those was silently discarded. The bar rendered perfectly and not one control
 * could be opened.
 *
 * Nothing caught it. TypeScript cannot: Slot types its child as ReactNode and
 * injects the props at runtime. The existing tests were source scans, and the
 * source looked entirely reasonable. Only rendering the component and clicking
 * it finds this class of bug, so that is what happens here.
 *
 * Two assertions per control, deliberately:
 *   the DOM button carries the props Radix injects — proving the wiring exists;
 *   a click opens a menu with rows in it — proving the wiring works.
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
  if (!("DOMRect" in globalThis)) {
    (globalThis as { DOMRect?: unknown }).DOMRect = class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
      get top() {
        return this.y;
      }
      get left() {
        return this.x;
      }
      get right() {
        return this.x + this.width;
      }
      get bottom() {
        return this.y + this.height;
      }
    };
  }
  // Radix guards pointer capture and scrolling behind these.
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
  // Explicit, because Testing Library only registers its own cleanup when
  // vitest globals are enabled. Without this the previous test's markup stays
  // in the document and every query finds two of everything.
  cleanup();
  vi.restoreAllMocks();
});

/** The trigger for a labelled control. Scoped to the bar, never a menu row. */
function trigger(label = "Salon"): HTMLElement {
  const match = screen
    .getAllByRole("button")
    .find((el) => el.firstElementChild?.textContent === label);
  if (!match) throw new Error(`no trigger for ${label}`);
  return match;
}

const SALONS = [
  { value: "0468", label: "0468 · Invented Store A", searchText: "Invented Store A" },
  { value: "1207", label: "1207 · Invented Store B", searchText: "Invented Store B" },
  { value: "0033", label: "0033 · Invented Store C", searchText: "Invented Store C" },
];

const WINDOWS = [
  { value: "current", label: "Current MTD" },
  { value: "2024", label: "vs 2024" },
  { value: "2019", label: "vs 2019", unavailable: true },
];

describe("a multi-select trigger", () => {
  it("receives the props Radix injects", () => {
    render(
      <MultiSelectMenu label="Salon" options={SALONS} selected={[]} onChange={() => {}} />,
    );
    const control = trigger("Salon");

    // These exist ONLY if the trigger forwards what Slot hands it. Their absence
    // is precisely the shipped bug: a button that looks right and is inert.
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.getAttribute("data-state")).toBe("closed");
  });

  it("opens on click and lists every option", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectMenu label="Salon" options={SALONS} selected={[]} onChange={() => {}} />,
    );

    await user.click(trigger("Salon"));

    await waitFor(() => {
      expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(SALONS.length);
    });
    expect(trigger("Salon").getAttribute("aria-expanded")).toBe("true");
  });

  it("reports the toggled value, leading zero intact", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelectMenu label="Salon" options={SALONS} selected={[]} onChange={onChange} />,
    );

    await user.click(trigger("Salon"));
    await waitFor(() => expect(screen.getAllByRole("menuitemcheckbox").length).toBe(3));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /0468/ }));

    expect(onChange).toHaveBeenCalledWith(["0468"]);
  });

  it("ticks the selected rows", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectMenu label="Salon" options={SALONS} selected={["1207"]} onChange={() => {}} />,
    );

    await user.click(trigger("Salon"));
    await waitFor(() => expect(screen.getAllByRole("menuitemcheckbox").length).toBe(3));

    expect(
      screen.getByRole("menuitemcheckbox", { name: /1207/ }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: /0468/ }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("narrows the list from the search box", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectMenu
        label="Salon"
        searchable
        options={SALONS}
        selected={[]}
        onChange={() => {}}
      />,
    );

    await user.click(trigger("Salon"));
    await waitFor(() => expect(screen.getAllByRole("menuitemcheckbox").length).toBe(3));

    await user.type(screen.getByLabelText("Search salon"), "1207");
    await waitFor(() => expect(screen.getAllByRole("menuitemcheckbox").length).toBe(1));
  });

  it("selects all of what the search shows, and clears everything", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelectMenu
        label="Salon"
        searchable
        options={SALONS}
        selected={["0033"]}
        onChange={onChange}
      />,
    );

    await user.click(trigger("Salon"));
    await waitFor(() => expect(screen.getAllByRole("menuitemcheckbox").length).toBe(3));

    await user.type(screen.getByLabelText("Search salon"), "0468");
    await waitFor(() => expect(screen.getAllByRole("menuitemcheckbox").length).toBe(1));

    // Select all takes what is VISIBLE, keeping the existing selection: the
    // alternative silently selects rows the user cannot see.
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(onChange).toHaveBeenCalledWith(["0033", "0468"]);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("summarises a multiple selection by count", () => {
    render(
      <MultiSelectMenu
        label="Salon"
        options={SALONS}
        selected={["0468", "1207"]}
        onChange={() => {}}
      />,
    );
    expect(trigger("Salon").textContent).toContain("2 selected");
  });
});

describe("a single-select trigger", () => {
  it("receives the props Radix injects and opens", async () => {
    const user = userEvent.setup();
    render(
      <SingleSelectMenu
        label="Window"
        options={WINDOWS}
        selected="2024"
        onChange={() => {}}
      />,
    );

    const control = trigger("Window");
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");

    await user.click(control);
    await waitFor(() => {
      expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(WINDOWS.length);
    });
  });

  it("keeps an unavailable option selectable and says so", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SingleSelectMenu
        label="Window"
        options={WINDOWS}
        selected="2024"
        onChange={onChange}
      />,
    );

    await user.click(trigger("Window"));
    await waitFor(() => expect(screen.getAllByRole("menuitemcheckbox").length).toBe(3));

    // Marked, never hidden — and choosing it must still work, because the view
    // then reports the gap rather than substituting another window's figure.
    const unavailable = screen.getByRole("menuitemcheckbox", { name: /vs 2019/ });
    expect(unavailable.textContent).toContain("not reported");
    await user.click(unavailable);
    expect(onChange).toHaveBeenCalledWith("2019");
  });

  it("renders as a plain label when there is only one option", () => {
    // A control that cannot change anything invites a click and then looks
    // broken, so the single-option case is deliberately not a dropdown.
    render(
      <SingleSelectMenu
        label="Period"
        options={[{ value: "2026-08-30", label: "MTD ending Aug 30, 2026" }]}
        selected="2026-08-30"
        onChange={() => {}}
      />,
    );
    const control = trigger("Period");
    expect(control.getAttribute("aria-haspopup")).toBeNull();
    expect((control as HTMLButtonElement).disabled).toBe(true);
  });
});
