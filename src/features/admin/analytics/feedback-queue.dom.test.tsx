// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/admin/analytics/feedback",
}));

import { parseFeedbackFilters } from "@/lib/analytics/feedback-filters";
import { parseFilters } from "@/lib/analytics/filters";
import { FeedbackQueue } from "./feedback-queue";

/**
 * THE STATUS MENU NAVIGATES, AND THEN GETS OUT OF THE WAY.
 *
 * Reported as "I can't click Open, Pending, In review": the menu stayed open
 * after a pick, still ticking the old status for the whole server round trip,
 * so the click looked like it had done nothing. Every option must push its own
 * URL, and the menu must close the moment one is chosen.
 */

afterEach(() => {
  cleanup();
  push.mockReset();
});

function queue(status: string) {
  return render(
    <FeedbackQueue
      base="/admin/analytics/feedback"
      filters={parseFilters({})}
      queue={parseFeedbackFilters({ status })}
      page={{ items: [], total: 0, page: 1, pageSize: 25 }}
      closedCounts={{ resolved: 1, dismissed: 0 }}
    />,
  );
}

async function pick(option: string) {
  const trigger = screen.getByText("Status").closest("button")!;
  await act(async () => fireEvent.click(trigger));
  const row = await screen.findByRole("menuitemradio", { name: option });
  await act(async () => fireEvent.click(row));
}

describe("the status filter", () => {
  it.each([
    ["Pending", "/admin/analytics/feedback?status=pending"],
    ["In review", "/admin/analytics/feedback?status=in_review"],
    ["Resolved", "/admin/analytics/feedback?status=resolved"],
    ["Dismissed", "/admin/analytics/feedback?status=dismissed"],
    /* Open is the default, so it is the bare URL. */
    ["Open (pending & in review)", "/admin/analytics/feedback"],
  ])("%s navigates to its own view", async (option, url) => {
    queue("all");
    await pick(option);
    expect(push).toHaveBeenLastCalledWith(url, { scroll: false });
  });

  it("closes the menu once a status is chosen", async () => {
    queue("all");
    await pick("Pending");
    expect(screen.queryByRole("menuitemradio", { name: "Pending" })).toBeNull();
  });
});
