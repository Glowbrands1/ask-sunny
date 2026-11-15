// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PastMeeting } from "@/features/l10/lib/past";
import { PastMeetings } from "./PastMeetings";

// Past meetings shows a recap's notes and "To-dos completed" (the Hub's 20261205120000; QA, 15 Nov 2026), and
// nothing for either on older recaps. Invented people only.
const meeting = (over: Partial<PastMeeting> = {}): PastMeeting => ({
  key: "recap-r1",
  source: "l10",
  heldAt: "2026-11-10T16:00:00Z",
  durationSeconds: 3480,
  ratingAvg: 8.5,
  attendees: [{ name: "Avery Quill", rating: 9 }],
  issuesSolved: 1,
  solvedTitles: ["Door lock"],
  solvedIssues: [{ title: "Door lock", owner: "Bo Lark" }],
  todosCompletedPct: 75,
  cascade: null,
  notes: "Talked about the holiday hours",
  openTodos: [],
  recorded: { todos: true, issues: true, notes: true },
  ...over,
});

afterEach(cleanup);

describe("Past meetings", () => {
  it("shows To-dos completed and the notes when the recap has them", () => {
    render(<PastMeetings meetingKey="stc-dm" meetingName="STC DM L10" meetings={[meeting()]} />);
    expect(screen.getByTestId("past-todos-completed").textContent).toBe("75%");
    expect(screen.getByText("Talked about the holiday hours")).toBeTruthy();
  });

  it("shows neither on an older recap", () => {
    render(<PastMeetings meetingKey="stc-dm" meetingName="STC DM L10" meetings={[meeting({ todosCompletedPct: null, notes: null })]} />);
    expect(screen.queryByTestId("past-todos-completed")).toBeNull();
    // Each row now also holds its full summary (the owner's request, 15 Nov 2026), which always lists the To-dos completed
    // stat and a NOTES section: there they read "—" and "No notes.". The row's own overview still shows neither.
    const summary = screen.getByTestId("meeting-summary");
    const overview = summary.closest("details")!.parentElement!.cloneNode(true) as HTMLElement;
    overview.querySelector("details")!.remove();
    expect(overview.textContent).not.toMatch(/To-dos completed|Notes/i);
    expect(within(summary).getByText("To-dos completed").nextElementSibling?.textContent).toBe("—");
    expect(within(summary).getByText("No notes.")).toBeTruthy();
  });

  it("each row opens its full summary: Summary for <date>, collapsed until opened", () => {
    render(<PastMeetings meetingKey="stc-dm" meetingName="STC DM L10" meetings={[meeting()]} />);
    const details = screen.getByTestId("past-meeting-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain("Summary for 11-10-2026");
    expect(within(screen.getByRole("group", { name: "Issues solved by owner", hidden: true })).getByText("Door lock")).toBeTruthy();
  });
});
