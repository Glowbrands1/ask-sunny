import { describe, expect, it } from "vitest";

import { importedMeetings, pastMeetings } from "./past";
import type { RecapRow } from "./types";

// Invented people only.
const recap = (over: Partial<RecapRow> = {}): RecapRow => ({
  id: "r1",
  meeting_key: "stc-dm",
  session_id: "s1",
  held_at: "2026-11-16T20:10:00.000Z",
  rating_avg: 9.5,
  attendee_count: 2,
  duration_seconds: 4200,
  cascade: "Share the new checklist",
  attendees: [
    { name: "Avery Quill", rating: 10 },
    { name: "Bo Lark", rating: 9 },
  ],
  open_todos: [],
  resolved_issues: ["Weekly issue"],
  ...over,
});

const bloom = {
  id: "bloom-mi1",
  source: "bloom-growth",
  startedAt: "2026-11-09T20:02:38.000Z",
  endedAt: "2026-11-09T21:11:21.000Z",
  attendees: [
    { name: "Avery Quill", rating: 9 },
    { name: "Bo Lark", rating: 8 },
    { name: "Cy Marlow", rating: null },
  ],
  issuesSolvedCount: 9,
};

describe("past meetings", () => {
  it("lists recaps and imported Bloom meetings together, newest first", () => {
    const rows = pastMeetings([recap()], { meetingHistory: [bloom, { ...bloom, id: "bloom-mi0", startedAt: "2026-11-02T20:00:00.000Z", endedAt: null }] });
    expect(rows.map((r) => r.key)).toEqual(["recap-r1", "bloom-mi1", "bloom-mi0"]);
    expect(rows[0]).toMatchObject({ source: "l10", durationSeconds: 4200, ratingAvg: 9.5, issuesSolved: 1, solvedTitles: ["Weekly issue"], cascade: "Share the new checklist" });
  });

  it("works out a Bloom meeting's length and average rating (people who did not rate are left out)", () => {
    const [row] = pastMeetings([], { meetingHistory: [bloom] });
    expect(row).toMatchObject({ source: "bloom-growth", durationSeconds: 4123, ratingAvg: 8.5, issuesSolved: 9, solvedTitles: [] });
  });

  it("leaves out deleted recaps and skips malformed imported rows", () => {
    expect(pastMeetings([recap({ deleted_at: "2026-11-17T00:00:00.000Z" })], {})).toEqual([]);
    expect(importedMeetings({ meetingHistory: [{ id: "x" }, { id: 3, startedAt: bloom.startedAt }, "nope", bloom] }).map((m) => m.id)).toEqual(["bloom-mi1"]);
    expect(importedMeetings({ meetingHistory: "nope" })).toEqual([]);
  });
});
