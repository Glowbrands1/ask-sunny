import { describe, expect, it } from "vitest";

import { hrReminderBody } from "./hr-approval-reminders";

/*
 * QA, 24 Nov 2026 (Ask Sunny, live): "The notification bell says "None is overdue yet"" while the Overview said 19
 * follow-ups were overdue. The line was about HR approvals waiting more than a business day; it now says so.
 */
describe("the 6 AM reminder's line names HR approval", () => {
  it('QA: the bell said "None is overdue yet" — it can no longer be read as "no follow-ups are overdue"', () => {
    expect(hrReminderBody(0)).toBe("No HR approval is overdue yet.");
    expect(hrReminderBody(0)).not.toBe("None is overdue yet.");
  });

  it("an overdue approval is counted as waiting for HR approval", () => {
    expect(hrReminderBody(1)).toBe("1 has waited more than a business day for HR approval.");
    expect(hrReminderBody(3)).toBe("3 have waited more than a business day for HR approval.");
  });
});
