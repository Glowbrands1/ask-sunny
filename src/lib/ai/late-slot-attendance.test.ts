import { describe, expect, it } from "vitest";

import { lateSlotHeading } from "./late-slot-attendance";

/* LATE_SLOT_READS_ATTENDANCE_ENABLED (QA, live Sunny, 10 Nov 2026). QA's wording; the person invented. */
describe("lateSlotHeading", () => {
  it("the model's Late Opening for a late arrival is Attendance", () => {
    expect(lateSlotHeading("Late Opening", "create a corrective action for Marnie Holloway, she was late on 11/3/26")).toBe("Attendance");
    expect(lateSlotHeading("Late Opening", "she showed up 20 minutes late for her shift")).toBe("Attendance");
    expect(lateSlotHeading("Late Opening", "tardy three times this month")).toBe("Attendance");
  });
  it("an opening stays Late Opening", () => {
    expect(lateSlotHeading("Late Opening", "create a corrective action for Marnie Holloway, failure to open on time on 11/3/26")).toBe("Late Opening");
    expect(lateSlotHeading("Late Opening", "she was late opening the salon")).toBe("Late Opening");
    expect(lateSlotHeading("Late Opening", "the salon opened late because she was late")).toBe("Late Opening");
  });
  it("any other heading, or none, is unchanged", () => {
    expect(lateSlotHeading("Standards of Conduct", "she was late on 11/3/26")).toBe("Standards of Conduct");
    expect(lateSlotHeading(null, "she was late on 11/3/26")).toBeNull();
    expect(lateSlotHeading("Late Opening", "she did not follow the opening checklist")).toBe("Late Opening");
  });
});
