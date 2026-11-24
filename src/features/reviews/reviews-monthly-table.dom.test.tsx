// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { EMPTY_REVIEW_FILTERS } from "@/lib/reviews/filters";
import { monthlyProgress } from "@/lib/reviews/monthly-progress";
import type { LocationRollup } from "@/lib/reviews/types";

import { ReviewsMonthlyTable } from "./reviews-monthly-table";

/** "yeah per month pls last 3 mos last 6 mos and YTD" — Nov 19 2026. */
afterEach(cleanup);

const salon = (storeCode: string, name: string, counting = true) =>
  ({
    storeCode,
    locationName: name,
    anchorReviewId: counting ? "anchor" : null,
  }) as unknown as LocationRollup;

describe("the month-by-month table", () => {
  const monthly = monthlyProgress(
    [
      { id: "1", store_code: "TX001", counted_at: "2026-08-15T17:00:00Z" },
      { id: "2", store_code: "TX001", counted_at: "2026-10-15T17:00:00Z" },
      { id: "3", store_code: "TX001", counted_at: "2026-11-15T17:00:00Z" },
      { id: "4", store_code: "TX002", counted_at: "2026-10-15T17:00:00Z" },
    ],
    ["TX001", "TX002"],
    "2026-11-19",
  );

  it("shows each month, then L3, L6 and YTD totals that open their reviews", () => {
    render(
      <ReviewsMonthlyTable
        monthly={monthly}
        locations={[salon("TX001", "Lakeview Glow"), salon("TX002", "Brookside Sun")]}
        filters={EMPTY_REVIEW_FILTERS}
        target={10}
      />,
    );
    const table = screen.getByRole("table", { name: "Qualifying reviews by month" });
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers[1]).toBe("Jan 2026");
    expect(headers).toContain("Novto date");
    expect(headers.slice(-3)).toEqual(["L3Aug – Oct 2026", "L6May – Oct 2026", "YTDJan – Nov 2026, to date"]);

    const row = within(table).getByRole("row", { name: /Lakeview Glow/ });
    const links = within(row).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["2", "2", "3"]);
    expect(links[0].getAttribute("href")).toBe(
      "/reviews?tab=reviews&week=3months&store=TX001&qualifying=yes#review-feed",
    );
    expect(links[2].getAttribute("href")).toContain("week=ytd");

    const footer = within(table).getByRole("row", { name: /All salons shown/ });
    expect(within(footer).getAllByRole("link").map((link) => link.textContent)).toEqual(["3", "3", "4"]);
  });

  /*
   * CHANGED ON PURPOSE (Nov 19 2026, "its 0 … also backfill"): a salon that is
   * not counting used to show dashes. Its months now show the reviews Google
   * dates to them, underlined as before counting, and it is in the total.
   */
  it("a salon that is not counting shows the reviews Google dates to each month, marked as before counting", () => {
    const withBefore = monthlyProgress(
      [{ id: "1", store_code: "TX001", counted_at: "2026-10-15T17:00:00Z" }],
      ["TX001", "TX002"],
      "2026-11-19",
      {
        posted: [{ id: "9", store_code: "TX002", google_absolute_date: "2026-09-10T17:00:00Z", google_estimated_at: null }],
        countingFrom: new Map([["TX001", "2026-10-01T05:00:00Z"], ["TX002", null]]),
      },
    );
    render(
      <ReviewsMonthlyTable
        monthly={withBefore}
        locations={[salon("TX001", "Lakeview Glow"), salon("TX002", "Brookside Sun", false)]}
        filters={EMPTY_REVIEW_FILTERS}
        target={10}
      />,
    );
    const row = screen.getByRole("row", { name: /Brookside Sun/ });
    expect(row.textContent).toContain("not counting");
    expect(within(row).getAllByTitle(/before the salon started counting/)).toHaveLength(11);
    expect(within(row).getAllByRole("link").map((link) => link.textContent)).toEqual(["1", "1", "1"]);
    const footer = screen.getByRole("row", { name: /All salons shown/ });
    expect(within(footer).getAllByRole("link").map((link) => link.textContent)).toEqual(["2", "2", "2"]);
  });

  /*
   * "for sunny its not aligned pls fix" (Nov 19 2026): the salon names were row
   * headers and the total sat in a <tfoot>, neither of which the table's styles
   * pad, so the names hugged the edge and the total row's figures slid left of
   * their columns. Both are ordinary body cells now.
   */
  it("lines up: salon names and the total row are body cells, one per column", () => {
    render(
      <ReviewsMonthlyTable
        monthly={monthly}
        locations={[salon("TX001", "Lakeview Glow"), salon("TX002", "Brookside Sun")]}
        filters={EMPTY_REVIEW_FILTERS}
        target={10}
      />,
    );
    const table = screen.getByRole("table", { name: "Qualifying reviews by month" });
    expect(table.querySelector("tfoot")).toBeNull();
    expect(table.querySelectorAll("tbody th")).toHaveLength(0);
    const columns = table.querySelectorAll("thead th").length;
    for (const tr of table.querySelectorAll("tbody tr")) {
      expect(tr.querySelectorAll("td")).toHaveLength(columns);
    }
  });

  it("says so when the figures could not be loaded", () => {
    render(<ReviewsMonthlyTable monthly={null} locations={[]} filters={EMPTY_REVIEW_FILTERS} target={10} />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});
