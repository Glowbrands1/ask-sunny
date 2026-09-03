import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usefulFacets } from "./filter-bar";
import { toggled } from "../filter-menu";
import type { FilterOptions } from "@/lib/reporting/read/types";

/**
 * THE FILTER SURFACE, GUARDED.
 *
 * Two of the three things checked here are the kind of defect that gets
 * reintroduced by a reasonable-looking edit, which is why they are checked by
 * scanning source rather than left to review.
 *
 * 1. FILTERING MUST NOT MOVE THE VIEWPORT. The dashboard is several screens
 *    tall. The previous filter bar navigated with plain `<Link>`s, so ticking a
 *    salon while reading the table threw the reader back to the page header
 *    every single time. Anyone adding one more link to this surface would
 *    reintroduce it silently, and no unit test of behaviour would notice.
 *
 * 2. FILTER STATE MUST STAY IN THE URL. The fix for the jump must not become
 *    "hold the selection in React state": that would break shared links,
 *    refresh and the back button all at once.
 *
 * A source scan is a lint, not a proof about a rendered page. It catches the two
 * ways these regress.
 */

const DIR = join(process.cwd(), "src", "features", "reports", "salon-performance");

/**
 * The shared menus moved up a level when Sales Totals began using them too, so
 * `filter-menu.tsx` is a sibling of this feature rather than inside it. Looked
 * up in both places, because a guard that silently stops finding its subject
 * passes for the wrong reason.
 */
const SHARED_DIR = join(DIR, "..");

function read(file: string): string {
  for (const dir of [DIR, SHARED_DIR]) {
    const path = join(dir, file);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error(`Guarded file not found in either directory: ${file}`);
}

describe("filtering does not move the viewport", () => {
  it("navigates through the router with scroll disabled", () => {
    const menu = read("filter-menu.tsx");
    expect(menu).toContain("router.push");
    // The flag itself. Without it, every tick scrolls to the top.
    expect(menu).toMatch(/scroll:\s*false/);
  });

  it("uses push rather than replace, so Back undoes one filter change", () => {
    const menu = read("filter-menu.tsx");
    expect(menu).not.toMatch(/router\.replace/);
  });

  it("keeps <Link> out of the filter bar entirely", () => {
    // The old pill wall was built from links, which is exactly why it jumped.
    // Anchors here would also lose the pending state the transition provides.
    const bar = read("filter-bar.tsx");
    expect(bar).not.toMatch(/from\s+"next\/link"/);
    expect(bar).not.toMatch(/<Link\b/);
  });

  it("disables scroll on every link that changes the sorted view", () => {
    /*
     * SORT LINKS RE-RENDER THIS PAGE, so the viewport must not move: a manager
     * halfway down the table who sorts a column expects the column to reorder
     * under their eyes, not to be thrown back to the page header.
     *
     * Every link in the file EXCEPT the drill-down, which goes to another page
     * and is checked by the opposite rule below. Framed as "everything else" on
     * purpose: a link added here later is caught by default rather than needing
     * to be remembered.
     */
    const table = read("ranking-table.tsx");
    const links = (table.match(/<Link\b[\s\S]*?>/g) ?? []).filter(
      (link) => !link.includes("salonHref"),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toContain("scroll={false}");
    }
  });

  it("lets the drill-down link scroll to the top, because it is a new page", () => {
    /*
     * The opposite rule, and not an oversight. `scroll={false}` on a link to
     * another route lands the reader at whatever offset the old page happened
     * to have — partway into a document they have not seen. The jump guard is
     * about links that re-render the page under the reader; this one replaces
     * it.
     *
     * Returning to the dashboard restores the FILTERS through the query string
     * the link carries. Scroll position on the way back is the browser's own
     * back-navigation restoration, which works because the drill-down is a real
     * history entry.
     */
    const table = read("ranking-table.tsx");
    const drillDown = (table.match(/<Link\b[\s\S]*?>/g) ?? []).filter((link) =>
      link.includes("salonHref"),
    );
    expect(drillDown).toHaveLength(1);
    expect(drillDown[0]).not.toContain("scroll={false}");
  });
});

describe("filter state stays in the URL", () => {
  it("derives the selection from props and writes it to a query string", () => {
    const menu = read("filter-menu.tsx");
    expect(menu).toContain("serializeReportFilters");
    // No local mirror of the selection: `useState` here is for the search box
    // and nothing else, so the URL cannot disagree with what is displayed.
    const stateUses = menu.match(/React\.useState/g) ?? [];
    expect(stateUses.length).toBe(1);
  });

  it("reads the selection from the parsed filters, not from a store", () => {
    const bar = read("filter-bar.tsx");
    expect(bar).toContain("filters.salonNumbers");
    expect(bar).not.toMatch(/useState|useReducer|createContext/);
  });
});

describe("the controls are menus, not a wall of chips", () => {
  it("offers one control per dimension", () => {
    const bar = read("filter-bar.tsx");
    for (const control of ["Period", "Window", "Metric", "Salon"]) {
      expect(bar).toContain(`label="${control}"`);
    }
    expect(bar).toContain("MoreFiltersMenu");
  });

  it("makes the salon selector searchable", () => {
    // Fifteen salons today, and a chain-wide file would carry a hundred.
    const bar = read("filter-bar.tsx");
    expect(bar).toMatch(/searchable/);
  });

  it("does not nest a dropdown inside the More panel", () => {
    // Radix portals the inner layer, so a pointer-down inside a nested popover
    // is not reliably treated as inside the outer one — the nested version
    // collapsed the whole panel the moment anything was ticked. The secondary
    // facets are therefore rendered in place.
    const bar = read("filter-bar.tsx");
    expect(bar).toContain("InlineMultiSelect");

    const menu = read("filter-menu.tsx");
    const inline = menu.slice(menu.indexOf("export function InlineMultiSelect"));
    const body = inline.slice(0, inline.indexOf("\n}\n"));
    expect(body).not.toContain("<Popover");
  });

  it("gives every multi-select Select all and Clear", () => {
    const menu = read("filter-menu.tsx");
    expect(menu).toContain("Select all");
    expect(menu).toContain("Clear");
  });

  it("summarises a multiple selection by count", () => {
    const menu = read("filter-menu.tsx");
    expect(menu).toMatch(/\$\{selected\.length\} selected/);
  });
});

describe("usefulFacets", () => {
  const options: FilterOptions = {
    district: [
      { value: "One", salonCount: 6 },
      { value: "Two", salonCount: 9 },
    ],
    // Every salon reports the same company in this file, so a control for it
    // could only ever return everything or nothing.
    company: [{ value: "Glo Brands", salonCount: 15 }],
    dma: [],
  };

  it("keeps a facet that can change the view", () => {
    expect(usefulFacets(options, ["district"])).toEqual(["district"]);
  });

  it("drops a facet with one option and one with none", () => {
    expect(usefulFacets(options, ["company", "dma", "quintile_group"])).toEqual([]);
  });
});

describe("toggled", () => {
  it("adds a value that is absent and removes one that is present", () => {
    expect(toggled(["0468"], "1207")).toEqual(["0468", "1207"]);
    expect(toggled(["0468", "1207"], "0468")).toEqual(["1207"]);
  });

  it("preserves a leading zero, because the salon number is text", () => {
    expect(toggled([], "0468")).toEqual(["0468"]);
  });
});
