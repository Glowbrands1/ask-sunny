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

  it("a salon that is not counting shows dashes, not zeros", () => {
    render(
      <ReviewsMonthlyTable
        monthly={monthly}
        locations={[salon("TX001", "Lakeview Glow"), salon("TX002", "Brookside Sun", false)]}
        filters={EMPTY_REVIEW_FILTERS}
        target={10}
      />,
    );
    const row = screen.getByRole("row", { name: /Brookside Sun/ });
    expect(within(row).queryAllByRole("link")).toHaveLength(0);
    expect(row.textContent).toContain("not counting");
    const footer = screen.getByRole("row", { name: /All salons shown/ });
    expect(within(footer).getAllByRole("link").map((link) => link.textContent)).toEqual(["2", "2", "3"]);
  });

  it("says so when the figures could not be loaded", () => {
    render(<ReviewsMonthlyTable monthly={null} locations={[]} filters={EMPTY_REVIEW_FILTERS} target={10} />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});
