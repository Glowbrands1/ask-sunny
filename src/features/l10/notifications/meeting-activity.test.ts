import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, headline, isPrefKind, parseNotifications } from "./logic";
import { VISIBLE_PREF_KINDS } from "./types";

// Paulyne, 23 Nov 2026: "can we get notifications for all people attendees when someone resolve or add or archived
// something in the meeting they are attendees in". The Leadership Hub's database sends these notes
// (leadership-hub 20261209120000_notifications_meeting_activity); the bell here shows the Hub's rows, so it must keep
// the new kinds (parseNotifications drops unknown ones) and word them as the Hub does.
describe("meeting activity notes in the L10 bell", () => {
  it("keeps the new kinds when the bell reads them", () => {
    const rows = parseNotifications(["item_added", "item_resolved", "item_archived"].map((kind, i) => ({ id: String(i), kind, meeting_key: "leadership", item_id: "rocks:r1" })));
    expect(rows?.map((r) => r.kind)).toEqual(["item_added", "item_resolved", "item_archived"]);
  });
  it("says who added, resolved or archived what", () => {
    expect(headline({ kind: "item_added", actor_name: "Pat Example", count: 1, item_id: "todos:t1" })).toBe("Pat Example added a to-do");
    expect(headline({ kind: "item_added", actor_name: "Pat Example", count: 1, item_id: "headlines:h1" })).toBe("Pat Example added a headline");
    expect(headline({ kind: "item_resolved", actor_name: "Pat Example", count: 1, item_id: "todos:t1" })).toBe("Pat Example completed a to-do");
    expect(headline({ kind: "item_resolved", actor_name: null, count: 1, item_id: "rocks:r1" })).toBe("Someone completed a rock");
    expect(headline({ kind: "item_archived", actor_name: "Pat Example", count: 2, item_id: "rocks:r1" })).toBe("Pat Example archived a rock (2 times)");
  });
  it("matches the Hub's defaults: every attendee hears about adds, done and archived", () => {
    expect(DEFAULT_PREFS).toMatchObject({ issue_added: true, issue_solved: true, item_added: true, item_resolved: true, item_archived: true });
    for (const k of ["item_added", "item_resolved", "item_archived"]) {
      expect(isPrefKind(k)).toBe(true);
      expect(VISIBLE_PREF_KINDS).toContain(k);
    }
  });
});
