import { describe, expect, it } from "vitest";

import { attendanceActionPlan, isAttendancePlan } from "./attendance-action-plan";
import { CA_ACTION_PLAN_CLOSING } from "./required-closing";

/** Pau, 26 Oct 2026: the Attendance Action Plan, without "[Follow-Up Date]". Invented names. */
const input = (over: Record<string, unknown> = {}) => ({
  citedPolicies: [] as string[],
  policyViolated: "Attendance Policy, JBA Policy Manual p.14",
  employeeName: "Marisol Quenby",
  payroll: { answer: null, amount: null },
  closing: null,
  ...over,
});

describe("attendance Action Plan", () => {
  it("is Pau's wording, with the name, no date and no bracket, then the form's closing", () => {
    const plan = attendanceActionPlan(input());
    expect(plan).toBe(
      "Marisol is expected to arrive on time for all scheduled shifts moving forward. " +
        "Leadership will monitor Marisol's attendance closely and provide coaching as needed. " +
        "A follow-up meeting will be scheduled to review progress. " +
        "Continued lateness will result in further disciplinary review per company policy. " +
        CA_ACTION_PLAN_CLOSING,
    );
    expect(plan).not.toMatch(/\[|\]|Follow-Up Date/);
  });

  it("uses the first name whatever the case it was typed in, and no pronoun", () => {
    for (const name of ["marisol quenby", "MARISOL QUENBY", "Marisol Quenby"]) {
      const plan = attendanceActionPlan(input({ employeeName: name }));
      expect(plan.startsWith("Marisol is expected")).toBe(true);
      expect(plan).not.toMatch(/\b(her|his|she|he)\b/i);
    }
  });

  it("with no name, reads the employee", () => {
    const plan = attendanceActionPlan(input({ employeeName: null }));
    expect(plan.startsWith("The employee is expected")).toBe(true);
    expect(plan).toContain("the employee's attendance");
  });

  it("keeps a version's own required closing", () => {
    expect(attendanceActionPlan(input({ closing: "Closing from this version." }))).toMatch(/Closing from this version\.$/);
  });

  it("covers Attendance only: not Late Opening, not Standards of Conduct", () => {
    expect(isAttendancePlan(input())).toBe(true);
    expect(isAttendancePlan(input({ citedPolicies: ["Attendance"] }))).toBe(true);
    expect(isAttendancePlan(input({ policyViolated: "tardiness — Attendance" }))).toBe(true);
    expect(isAttendancePlan(input({ citedPolicies: ["Late Opening"] }))).toBe(false);
    expect(isAttendancePlan(input({ citedPolicies: ["Late Opening", "Attendance"] }))).toBe(false);
    expect(isAttendancePlan(input({ policyViolated: "Standards of Conduct" }))).toBe(false);
    expect(isAttendancePlan(input({ policyViolated: null }))).toBe(false);
  });
});
