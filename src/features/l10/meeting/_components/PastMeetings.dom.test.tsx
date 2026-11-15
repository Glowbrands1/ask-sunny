// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
    expect(screen.queryByText(/To-dos completed/)).toBeNull();
    expect(screen.queryByText(/Notes:/)).toBeNull();
  });
});
