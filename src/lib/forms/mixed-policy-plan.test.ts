import { afterEach, describe, expect, it, vi } from "vitest";

import { attendanceActionPlan } from "./attendance-action-plan";

/* MIXED_POLICY_PLAN_ENABLED (Pau's option A, 13 Nov 2026). */
const input = (citedPolicies: string[]) => ({ citedPolicies, employeeName: "Nell Orrin", payroll: { answer: null, amount: null } });

describe("MIXED_POLICY_PLAN_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: Attendance and another policy get the attendance plan alone (as before)", () => {
    expect(attendanceActionPlan(input(["Attendance Policy", "Standards of Conduct Policy"]))).not.toMatch(/Management will review/);
  });

  it("on: one line per other policy, before the closing; the attendance plan is unchanged", () => {
    const only = attendanceActionPlan(input(["Attendance Policy"]));
    vi.stubEnv("MIXED_POLICY_PLAN_ENABLED", "true");
    expect(attendanceActionPlan(input(["Attendance Policy"]))).toBe(only);
    const mixed = attendanceActionPlan(input(["Attendance Policy", "Standards of Conduct Policy", "Cell Phone/Smart Watch Policy"]));
    expect(mixed).toContain("Continued lateness will result in further disciplinary review per company policy. Management will review the Standards of Conduct policy with Nell. Management will review the Cell Phone/Smart Watch policy with Nell. Future policy violations");
  });

  it("on: Other and Late Opening add no line, and a policy listed twice adds one", () => {
    vi.stubEnv("MIXED_POLICY_PLAN_ENABLED", "true");
    const plan = attendanceActionPlan(input(["Attendance Policy", "Other", "Standards of Conduct", "Standards of Conduct Policy"]));
    expect(plan.match(/Management will review/g)?.length).toBe(1);
    expect(plan).not.toMatch(/Other policy/);
  });

  it("on: a Policy Violated that is the Attendance citation adds no line (the pack's diff, 14 Nov 2026)", () => {
    vi.stubEnv("MIXED_POLICY_PLAN_ENABLED", "true");
    // "take the attendance policy off the form" refreshed the plan from "Attendance Policy, JBA Policy Manual p.14",
    // and "JBA Policy Manual p.14" was read as a second policy: "Management will review the JBA Policy Manual p.14 policy".
    const plan = attendanceActionPlan({ ...input([]), policyViolated: "Attendance Policy, JBA Policy Manual p.14" });
    expect(plan).not.toMatch(/Management will review/);
    expect(plan).not.toMatch(/JBA Policy Manual/);
  });
});
