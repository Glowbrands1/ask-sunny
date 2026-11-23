// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TrainingAssignmentsData, TrainingHomeData } from "./training-home";

/**
 * AI TRAINING -> ASSIGNMENTS, RENDERED (Pau, 23 Nov 2026): the tab exists only for the tracker's named people (the page
 * hands it data only for them); the summary, the grid and a box's click. The people are invented.
 */

const replace = vi.fn();
const refresh = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => "/ai-training",
  useSearchParams: () => search,
}));
vi.mock("./actions", () => ({ editMySubmission: vi.fn() }));
const setMark = vi.fn<(input: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock("./assignment-actions", () => ({
  setAssignmentMarkAction: (input: unknown) => setMark(input),
  addAssignmentPeopleAction: vi.fn(async () => ({ ok: true })),
  removeAssignmentPersonAction: vi.fn(async () => ({ ok: true })),
}));

const { TrainingHome } = await import("./training-home");

const data: TrainingHomeData = {
  catalog: { tracks: [], modules: [], lessons: [] },
  policy: null,
  bestPractices: null,
  announcement: null,
  mine: [],
};

const assignments: TrainingAssignmentsData = {
  today: "2026-11-23",
  problem: null,
  tracker: {
    people: [
      { id: "11111111-1111-4111-8111-111111111111", name: "Ash Fernwell", group: null, startDate: null, sortOrder: null },
      { id: "22222222-2222-4222-8222-222222222222", name: "Bram Tolliver", group: "Ops", startDate: null, sortOrder: null },
    ],
    marks: [{ personId: "11111111-1111-4111-8111-111111111111", month: "2026-11", half: 1, state: "done" }],
  },
};

afterEach(() => {
  cleanup();
  setMark.mockClear();
  search = new URLSearchParams();
});

describe("AI Training -> Assignments", () => {
  it("is not there for anyone the page gave no tracker to, even asked for by address", () => {
    search = new URLSearchParams("tab=assignments");
    render(<TrainingHome isAdmin={true} problem={null} data={data} />);
    expect(screen.queryByRole("tab", { name: "Assignments" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Training" }).getAttribute("aria-selected")).toBe("true");
  });

  it("for the tracker's people: this half's count, who is still to do, and the grid", () => {
    search = new URLSearchParams("tab=assignments");
    render(<TrainingHome isAdmin={false} problem={null} data={data} assignments={assignments} />);
    expect(screen.getByRole("tab", { name: "Assignments" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/This half · Nov 16–30, 2026/)).toBeTruthy();
    expect(screen.getByText("of 2 done")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark Bram Tolliver done for Nov 16–30, 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ash Fernwell, Nov 2026, 16th to month end: Done" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bram Tolliver, Oct 2026, 1st to 15th: Missing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bram Tolliver, Nov 2026, 16th to month end: Due" })).toBeTruthy();
  });

  it("a box cycles Done → More time, and saves that mark", async () => {
    search = new URLSearchParams("tab=assignments");
    render(<TrainingHome isAdmin={false} problem={null} data={data} assignments={assignments} />);
    fireEvent.click(screen.getByRole("button", { name: "Ash Fernwell, Nov 2026, 16th to month end: Done" }));
    expect(screen.getByRole("button", { name: "Ash Fernwell, Nov 2026, 16th to month end: More time" })).toBeTruthy();
    await waitFor(() => expect(setMark).toHaveBeenCalledWith({ personId: "11111111-1111-4111-8111-111111111111", month: "2026-11", half: 1, state: "extended" }));
  });
});
