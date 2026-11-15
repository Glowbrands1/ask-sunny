import { describe, expect, it } from "vitest";

import { importedMeetings, pastMeetings, todosCompletedPct } from "./past";
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

  it("carries a recap's meeting notes (the Hub's 20261205120000); older recaps and Bloom imports have none", () => {
    const rows = pastMeetings([recap({ id: "r2", held_at: "2026-11-17T20:00:00.000Z", notes: "Talked about the schedule" }), recap()], { meetingHistory: [bloom] });
    expect(rows.map((r) => r.notes)).toEqual(["Talked about the schedule", null, null]);
  });

  it("reads solved issues stored as plain titles (older recaps) and as { title, owner } (from 15 Nov 2026)", () => {
    const [row] = pastMeetings([recap({ resolved_issues: ["Old title", { title: "New title", owner: "Bo Lark" }] })], {});
    expect(row.solvedTitles).toEqual(["Old title", "New title"]);
    expect(row.solvedIssues).toEqual([
      { title: "Old title", owner: "" },
      { title: "New title", owner: "Bo Lark" },
    ]);
  });

  it("works out To-dos completed from the recap's counts, and has none on older recaps", () => {
    expect(pastMeetings([recap({ todos_done: 3, todos_total: 4 })], {})[0].todosCompletedPct).toBe(75);
    expect(pastMeetings([recap()], {})[0].todosCompletedPct).toBeNull();
  });

  it("todosCompletedPct: the share done, or null when the recap has no counts (shown as nothing)", () => {
    expect(todosCompletedPct({ todos_done: 3, todos_total: 4 })).toBe(75);
    expect(todosCompletedPct({ todos_done: 0, todos_total: 0 })).toBeNull();
    expect(todosCompletedPct({ todos_done: null, todos_total: null })).toBeNull();
    expect(todosCompletedPct({})).toBeNull();
  });

  it("reads the Bloom enrichment (solvedIssues, todos, notes) when a row carries it, and says it was not recorded when not", () => {
    const enriched = {
      ...bloom,
      solvedIssues: [{ title: "Door lock", owner: "Avery Quill" }, { title: 7 }, { title: "Late shift" }],
      todos: [{ text: "Order towels", owner: "Bo Lark", dueDate: "2026-11-20" }, { text: "Call the landlord", owner: "Avery Quill", dueDate: null }, { owner: "x" }],
      notes: "Talked about the holiday hours",
    };
    const [rich] = pastMeetings([], { meetingHistory: [enriched] });
    expect(rich.solvedIssues).toEqual([
      { title: "Door lock", owner: "Avery Quill" },
      { title: "Late shift", owner: "" },
    ]);
    expect(rich.solvedTitles).toEqual(["Door lock", "Late shift"]);
    expect(rich.issuesSolved).toBe(9); // the stored count, when it is larger than the listed issues
    expect(rich.openTodos).toEqual([
      { text: "Order towels", owner: "Bo Lark", due: "2026-11-20" },
      { text: "Call the landlord", owner: "Avery Quill", due: "" },
    ]);
    expect(rich.notes).toBe("Talked about the holiday hours");
    expect(rich.recorded).toEqual({ todos: true, issues: true, notes: true });
    // Imported before the enrichment: nothing about to-dos, issues or notes is recorded.
    const [plain] = pastMeetings([], { meetingHistory: [bloom] });
    expect(plain.recorded).toEqual({ todos: false, issues: false, notes: false });
    expect([plain.openTodos, plain.solvedIssues, plain.notes]).toEqual([[], [], null]);
    // An empty list is recorded (none), unlike a missing one.
    const [empty] = pastMeetings([], { meetingHistory: [{ ...bloom, solvedIssues: [], todos: [] }] });
    expect(empty.recorded).toEqual({ todos: true, issues: true, notes: false });
    // Recaps always record all three.
    expect(pastMeetings([recap()], {})[0].recorded).toEqual({ todos: true, issues: true, notes: true });
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
