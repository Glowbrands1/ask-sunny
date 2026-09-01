import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usefulFacets } from "./filter-bar";
import { toggled } from "./filter-menu";
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

function read(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
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
    const table = read("ranking-table.tsx");
    const links = table.match(/<Link\b[\s\S]*?>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toContain("scroll={false}");
    }
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
