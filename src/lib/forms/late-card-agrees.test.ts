import { describe, expect, it } from "vitest";

import { LATE_OPENING_REFERENCE } from "@/lib/ai/form-card-slots";
import { plainLateIsAttendance } from "./ca-policy";

/*
 * LATE_CARD_AGREES_ENABLED (QA, Sunny live r22 + r26, 11 Nov 2026): "create a CA for <roster person, lowercase>, she was
 * late on 11/3/26" — the reply read Attendance, the card Late Opening. The person is invented.
 */
describe("LATE_CARD_AGREES_ENABLED", () => {
  it("plain late is Attendance; a late opening or a no-show is not", () => {
    expect(plainLateIsAttendance("create a CA for odette ravensworth, she was late on 11/3/26")).toBe(true);
    expect(plainLateIsAttendance("create a CA for odette ravensworth, she was late to work on 11/3/26")).toBe(true);
    expect(plainLateIsAttendance("create a CA for odette ravensworth, she was late opening the salon on 11/3/26")).toBe(false);
    expect(plainLateIsAttendance("create a CA for odette ravensworth, she opened late on 11/3/26")).toBe(false);
    expect(plainLateIsAttendance("create a CA for odette ravensworth, no call no show on 11/3/26")).toBe(false);
  });

  it("the app's own Late Opening reference line is taken out whole", () => {
    const notes = "It happened on 11/3/2026. Policy reference: Late Opening, JBA Policy Manual p.15. Incident: Attendance.";
    expect(notes.replace(LATE_OPENING_REFERENCE, " ")).toBe("It happened on 11/3/2026.   Incident: Attendance.");
  });
});
