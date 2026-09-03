// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MultiSelectMenu } from "../filter-menu";

/**
 * THE WORD ON THE ACTION HAS TO MATCH WHAT THE ACTION DOES.
 *
 * In Sales Totals an empty salon selection means EVERY salon in the delivery —
 * the URL omits the parameter and the page falls back to all fifteen. So the
 * shared menu's `Clear` was describing the mechanism (empty the array) and
 * contradicting the result (widen to everything): a manager with four salons
 * selected who wanted the whole delivery back had no way to tell that this was
 * the control for it.
 *
 * These tests pin BOTH halves of the fix, because either alone is a defect:
 *
 *   the label reads "Reset to all" where empty means all;
 *   the default is still "Clear" everywhere else, so Salon Performance is
 *   untouched. Its facets read as "no filter on this facet" rather than as a
 *   population, and it carries its own bar-level "Reset filters" button, so
 *   the two words are already doing different jobs there;
 *   and the behaviour is unchanged in both cases. It empties the selection.
 *   The label was the bug; the data semantics were correct.
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

const SALONS = [
  { value: "0468", label: "Invented Store A", note: "0468" },
  { value: "1207", label: "Invented Store B", note: "1207" },
  { value: "0033", label: "Invented Store C", note: "0033" },
];

/** The trigger for a labelled control. Scoped to the bar, never a menu row. */
function trigger(label: string): HTMLElement {
  const match = screen
    .getAllByRole("button")
    .find((el) => el.firstElementChild?.textContent === label);
  if (!match) throw new Error(`no trigger for ${label}`);
  return match;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, clearLabel?: string) {
  const onChange = vi.fn();
  render(
    <MultiSelectMenu
      label="Salons"
      options={SALONS}
      selected={["0468", "1207"]}
      onChange={onChange}
      clearLabel={clearLabel}
    />,
  );
  await user.click(trigger("Salons"));
  await waitFor(() => expect(screen.getAllByRole("menuitemcheckbox").length).toBe(3));
  return onChange;
}

describe("the Sales Totals salon menu", () => {
  it("calls the action 'Reset to all', not 'Clear'", async () => {
    const user = userEvent.setup();
    await openMenu(user, "Reset to all");

    expect(screen.getByRole("button", { name: "Reset to all" })).toBeTruthy();
    // The misleading word is gone from this menu entirely.
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("still empties the selection, which is what shows all salons", async () => {
    /*
     * THE DATA SEMANTICS ARE UNCHANGED. `[]` means "every salon in this
     * delivery" — see `serializeSalesTotalsFilters`, which omits the parameter
     * rather than sending `salons=`. Only the label moved.
     */
    const user = userEvent.setup();
    const onChange = await openMenu(user, "Reset to all");

    await user.click(screen.getByRole("button", { name: "Reset to all" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("disables the action when everything is already showing", async () => {
    // Nothing selected is already all salons, so there is nothing to reset to.
    const user = userEvent.setup();
    render(
      <MultiSelectMenu
        label="Salons"
        options={SALONS}
        selected={[]}
        onChange={() => {}}
        clearLabel="Reset to all"
      />,
    );
    await user.click(trigger("Salons"));
    await waitFor(() => expect(screen.getAllByRole("menuitemcheckbox").length).toBe(3));

    expect(
      (screen.getByRole("button", { name: "Reset to all" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("every other multi-select", () => {
  it("keeps saying 'Clear' when the caller does not rename it", async () => {
    /*
     * Salon Performance passes no label, so its facet menus and its Salon menu
     * are exactly as they were. This is the assertion that makes the change
     * safe to make in a SHARED component: the new prop is opt-in, and omitting
     * it changes nothing.
     */
    const user = userEvent.setup();
    await openMenu(user);

    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset to all" })).toBeNull();
  });

  it("empties the selection identically, whatever it is called", async () => {
    const user = userEvent.setup();
    const onChange = await openMenu(user);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("the wiring, at the source", () => {
  it("Sales Totals is the caller that renames it", async () => {
    // A render test cannot reach the page's own composition, and the prop is
    // easy to drop in a refactor — so the caller is pinned directly.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/features/reports/sales-totals/filter-bar.tsx", "utf8"),
    );
    expect(source).toContain('clearLabel="Reset to all"');
    // And the semantics it depends on are still there: empty is omitted, so
    // empty reads as "all" rather than "none".
    expect(source).toContain('if (filters.salons.length > 0) params.set("salons"');
  });

  it("Salon Performance renames nothing", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/features/reports/salon-performance/filter-bar.tsx", "utf8"),
    );
    expect(source).not.toContain("clearLabel");
  });
});
