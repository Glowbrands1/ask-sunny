// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

/**
 * THE DEMO DEPLOYMENT DRAWS THE LIVE SCREEN.
 *
 * A Vercel Preview runs in demo mode, never holds the Supabase key, and so
 * renders `ReviewsDemoScreen`. That screen used to be a hand-drawn copy of the
 * dashboard, and the October 2026 redesign's preview showed the OLD page
 * because the copy had not changed. These tests pin that the demo is the live
 * goal UI — tiles, goal table and ranked leaderboard — over seeded figures.
 */

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/reviews",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("./reviews-ask-bar", () => ({ ReviewsAskBar: () => null }));
vi.mock("./reviews-timeline", () => ({ ReviewsTimeline: () => null }));
vi.mock("@/lib/reviews/timezone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reviews/timezone")>()),
  /* A fixed Central date, so the pace mark and the month are deterministic. */
  googleReviewsToday: () => "2026-10-12",
}));

import { ReviewsDemoScreen } from "./reviews-demo-screen";

afterEach(() => {
  cleanup();
  search = "";
});

describe("the demo Google Reviews screen", () => {
  it("opens on the approved Overview: the month's goal, its tiles and the goal table", () => {
    render(<ReviewsDemoScreen />);

    expect(screen.getByRole("heading", { name: /October review goal/i })).toBeTruthy();
    expect(screen.getByText("Salons at goal", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Reviews still needed")).toBeTruthy();

    const table = screen.getByRole("table", { name: "Salon goal progress" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((node) => (node.textContent ?? "").replace(/[↕▲▼]/g, "").trim());
    expect(headers).toContain("Monthly target");
    expect(headers.some((text) => text.startsWith("Progress toward target"))).toBe(true);
    for (const removed of ["Unanswered", "All this week", "Last week"]) {
      expect(headers.some((text) => text.startsWith(removed)), removed).toBe(false);
    }
    /* All fifteen salons, Grand Island first on 12 of 10. */
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(15);
    expect(rows[0].textContent).toContain("NE Grand Island");
    expect(rows[0].textContent).toContain("120%");
  });

  it("draws the ranked leaderboard on its tab, with Not counting unranked", () => {
    search = "tab=leaderboard";
    render(<ReviewsDemoScreen />);

    const list = screen.getByRole("list", { name: /Salons ranked/ });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(15);
    expect(within(items[0]).getByLabelText("Rank 1").textContent).toBe("1");
    expect(items[0].textContent).toContain("NE Grand Island");
    expect(items[0].textContent).toContain("Goal met");
    expect(items[items.length - 1].textContent).toContain("MO St Joseph");
    expect(items[items.length - 1].textContent).toContain("Not counting");
    expect(document.body.textContent).not.toContain("Replies waiting");
  });

  it("narrows to one salon from the URL, as the live page does", () => {
    search = "store=141";
    render(<ReviewsDemoScreen />);

    expect(screen.getByText("Monthly goal")).toBeTruthy();
    const rows = within(screen.getByRole("table", { name: "Salon goal progress" }))
      .getAllByRole("row")
      .slice(1);
    expect(rows).toHaveLength(1);
  });

  it("has no Needs Response tab, and an old link to it opens the Overview", () => {
    search = "tab=needs";
    render(<ReviewsDemoScreen />);

    expect(screen.queryByRole("link", { name: /Needs Response/ })).toBeNull();
    expect(document.getElementById("response-queue")).toBeNull();
    expect(screen.getByRole("heading", { name: /October review goal/i })).toBeTruthy();
  });
});
