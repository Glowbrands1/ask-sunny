// @vitest-environment jsdom
// Copied from the Leadership Hub (src/app/meetings/_components/MeetingSummary.test.tsx); keep in step with it.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { mmddyyyy } from "@/features/l10/lib/bloom";
import { pastMeetings, recapToPast, type PastMeeting } from "@/features/l10/lib/past";
import type { RecapRow } from "@/features/l10/lib/types";
import { PastMeetingDetails } from "./MeetingSummary";

// Each Past meetings / recaps row opens its summary, as Bloom's "Summary for <date>" (the owner's request,
// 15 Nov 2026). Invented people and data only.
const recap: RecapRow = {
  id: "r1",
  meeting_key: "stc-dm",
  session_id: "s1",
  held_at: "2026-11-10T16:00:00Z",
  rating_avg: 8.5,
  attendee_count: 2,
  duration_seconds: 3480,
  cascade: "Share the new schedule",
  attendees: [
    { name: "Avery Quill", rating: 9 },
    { name: "Bo Lark", rating: 8 },
  ],
  open_todos: [{ text: "Order towels", owner: "Avery Quill", dueDate: "2026-11-20" }],
  resolved_issues: [{ title: "Door lock", owner: "Bo Lark" }, "Older plain title"],
  notes: "Talked about the holiday hours",
  todos_done: 3,
  todos_total: 4,
};
const bloomRow = (over: Record<string, unknown> = {}): PastMeeting =>
  pastMeetings([], { meetingHistory: [{ id: "b1", source: "bloom-growth", startedAt: "2026-10-27T16:00:00Z", endedAt: "2026-10-27T17:10:00Z", attendees: [{ name: "Cy Marlow", rating: 7 }], issuesSolvedCount: 2, ...over }] })[0];

const open = async (m: PastMeeting) => {
  const user = userEvent.setup();
  render(<PastMeetingDetails meeting={m} people={[]} />);
  const toggle = screen.getByText(`Summary for ${mmddyyyy(m.heldAt)}`).closest("summary")!;
  const details = toggle.closest("details")!;
  expect(details.open).toBe(false); // collapsed until opened
  await user.click(toggle);
  expect(details.open).toBe(true);
  return within(screen.getByTestId("meeting-summary"));
};

afterEach(cleanup);

describe("Past meeting summary", () => {
  it("a recap row opens on click into the Bloom summary: stats, feedback, to-dos and issues by owner, notes, cascade", async () => {
    const s = await open(recapToPast(recap));
    expect(s.getAllByRole("definition").map((d) => d.textContent)).toEqual(["8.5", "75%", "2", "58m"]);
    expect(within(s.getByRole("list", { name: "Feedback" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["9Avery Quill", "8Bo Lark"]);
    expect(s.getByRole("group", { name: "To-dos by owner" }).textContent).toBe("AQAvery QuillOrder towels11-20-2026");
    expect(s.getByRole("group", { name: "Issues solved by owner" }).textContent).toBe("BLBo LarkDoor lockUUnassignedOlder plain title");
    expect(s.getByText("Talked about the holiday hours")).toBeTruthy();
    expect(s.getByText("Share the new schedule")).toBeTruthy();
  });

  it("the toggle is a native summary element, so Enter and Space open it from the keyboard", () => {
    render(<PastMeetingDetails meeting={recapToPast(recap)} people={[]} />);
    const toggle = screen.getByText(`Summary for ${mmddyyyy(recap.held_at)}`).closest("summary")!;
    expect(toggle.tagName).toBe("SUMMARY");
    expect(screen.queryByRole("textbox")).toBeNull(); // read-only
  });

  it("a Bloom row without the enrichment says Not recorded for to-dos, issues and notes", async () => {
    const s = await open(bloomRow());
    const sections = s.getAllByRole("heading", { level: 3 }).map((h) => [h.textContent, h.nextElementSibling?.textContent]);
    expect(sections).toEqual([
      ["FEEDBACK", "7Cy Marlow"],
      ["TO-DOS", "Not recorded"],
      ["ISSUES SOLVED", "Not recorded (2 solved)"],
      ["NOTES", "Not recorded"],
    ]);
  });

  it("a Bloom row with the enrichment shows its to-dos and solved issues by owner, and its notes", async () => {
    const s = await open(
      bloomRow({
        solvedIssues: [{ title: "Door lock", owner: "Cy Marlow" }],
        todos: [{ text: "Order towels", owner: "Dee Hart", dueDate: "2026-11-03" }],
        notes: "Holiday hours agreed",
      }),
    );
    expect(s.getByRole("group", { name: "To-dos by owner" }).textContent).toBe("DHDee HartOrder towels11-03-2026");
    expect(s.getByRole("group", { name: "Issues solved by owner" }).textContent).toBe("CMCy MarlowDoor lock");
    expect(s.getByText("Holiday hours agreed")).toBeTruthy();
    expect(s.queryByText("Not recorded")).toBeNull();
  });
});
