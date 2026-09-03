import { describe, expect, it } from "vitest";

import {
  serializeSalesTotalsFilters,
  type SalesTotalsFilters,
} from "./filter-bar";

/**
 * THE SALES TOTALS FILTER STATE, AS A URL.
 *
 * Every filter lives in the query string, which is what makes a shared link
 * reproduce exactly what somebody was looking at and what makes Back undo one
 * filter change rather than leaving the report. These tests pin the encoding,
 * because it is the contract between the client controls and the server page —
 * and the two are in different files, so nothing else would catch a drift.
 */

const BASE: SalesTotalsFilters = {
  reportDate: "2026-09-02",
  window: "daily",
  scope: "all_salons",
  salons: [],
  metric: "grand_total",
  sort: null,
};

function params(filters: Partial<SalesTotalsFilters> = {}) {
  return serializeSalesTotalsFilters({ ...BASE, ...filters });
}

describe("what ends up in the URL", () => {
  it("always carries date, window, scope and metric", () => {
    const query = params();
    expect(query.get("date")).toBe("2026-09-02");
    expect(query.get("window")).toBe("daily");
    expect(query.get("scope")).toBe("all_salons");
    expect(query.get("metric")).toBe("grand_total");
  });

  it("omits the salon list entirely when every salon is in view", () => {
    /*
     * "All salons in this delivery" is the default, so it is the ABSENCE of the
     * parameter rather than an empty one. `salons=` in a shared link reads as
     * "no salons", which is a different and much worse default.
     */
    expect(params({ salons: [] }).has("salons")).toBe(false);
    /*
     * Checked as a KEY, not as a substring. `scope=all_salons` contains the
     * text "salons", so a substring assertion here passes or fails for the
     * wrong reason — it fired on the scope value the first time it ran.
     */
    expect([...params().keys()]).not.toContain("salons");
  });

  it("carries a multi-salon selection as a comma-separated list", () => {
    const query = params({ salons: ["0468", "0394", "0314"] });
    expect(query.get("salons")).toBe("0468,0394,0314");
  });

  it("carries a single salon the same way as several", () => {
    // One encoding, so the page needs one parser rather than two branches.
    expect(params({ salons: ["0468"] }).get("salons")).toBe("0468");
  });

  it("omits sort until one is chosen", () => {
    expect(params({ sort: null }).has("sort")).toBe(false);
    expect(params({ sort: "tans" }).get("sort")).toBe("tans");
  });

  it("keeps the other filters when one changes", () => {
    /*
     * The behaviour every control depends on: changing the metric must not
     * silently reset the date, the window or the salon selection.
     */
    const before: SalesTotalsFilters = {
      ...BASE,
      window: "mtd",
      salons: ["0468", "0394"],
      sort: "efts",
    };
    const after = serializeSalesTotalsFilters({ ...before, metric: "tans" });

    expect(after.get("metric")).toBe("tans");
    expect(after.get("window")).toBe("mtd");
    expect(after.get("salons")).toBe("0468,0394");
    expect(after.get("sort")).toBe("efts");
    expect(after.get("date")).toBe("2026-09-02");
  });

  it("round-trips through URLSearchParams unchanged", () => {
    const filters: SalesTotalsFilters = {
      reportDate: "2026-09-01",
      window: "mtd",
      scope: "stc_franchisees",
      salons: ["0468", "0314"],
      metric: "sunless_sessions",
      sort: "label",
    };
    const parsed = new URLSearchParams(serializeSalesTotalsFilters(filters).toString());

    expect(parsed.get("date")).toBe("2026-09-01");
    expect(parsed.get("window")).toBe("mtd");
    expect(parsed.get("scope")).toBe("stc_franchisees");
    expect(parsed.get("salons")?.split(",")).toEqual(["0468", "0314"]);
    expect(parsed.get("metric")).toBe("sunless_sessions");
    expect(parsed.get("sort")).toBe("label");
  });
});

describe("the scroll jump", () => {
  it("navigates through the router with scroll disabled, never a bare Link", async () => {
    /*
     * THE ROOT CAUSE, pinned. The first version of this bar was a wall of
     * inline `<Link href>` elements. Next scrolls to the top of the document on
     * navigation by DEFAULT, so changing a filter from halfway down the page
     * threw the reader back to the header every single time — reported as the
     * page "jumping upward".
     *
     * Asserted against the source, because the behaviour lives in a prop and a
     * hook rather than in output a render test can observe.
     */
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/features/reports/sales-totals/filter-bar.tsx", "utf8"),
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

    // The bar drives navigation through the shared hook, which pushes with
    // `scroll: false`.
    expect(code).toContain("useQueryNavigation");
    // And contains no plain link that would scroll.
    expect(code).not.toContain("<Link");
  });

  it("the shared hook disables scrolling, and pushes rather than replaces", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/features/reports/filter-menu.tsx", "utf8"),
    );
    expect(source).toContain("scroll: false");
    // `push`, so Back undoes one filter change instead of leaving the report.
    expect(source).toContain("router.push");
  });

  it("the sortable table's links do not scroll either", async () => {
    // The table is the furthest down the page, so it is the worst place to be
    // thrown to the top from.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/features/reports/sales-totals/salon-table.tsx", "utf8"),
    );
    expect(source).toContain("scroll={false}");
  });
});
