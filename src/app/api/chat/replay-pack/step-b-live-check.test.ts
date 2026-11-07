import { describe, expect, it } from "vitest";

import { STEP_B_REFUSAL_LIVE_SCENARIOS, STEP_B_REFUSAL_SCENARIOS } from "./nov7-step-b-refusals-scenarios";

/**
 * QA's round-3 bar for EDIT_MAKE_IT_ABOUT + Step B (7 Nov 2026), checked in the LIVE eval: on "I need you to make
 * it about showing up late and please list the policy make the date for 10/14/26." Details is about showing up
 * late, the Date is 10/14/26, and "please list the policy" is not silently ignored.
 */
const lateDate = STEP_B_REFUSAL_LIVE_SCENARIOS.find((scenario) => scenario.id === "sun-late-date")!;
const run = (coachingDetails: string, reply: string) =>
  ({
    card: { templateKey: "coaching", employeeName: "Thaddeus Lowestoft" },
    reply,
    replies: [reply],
    turnCards: [],
    flagsOn: [],
    saved: { employee_name: "Thaddeus Lowestoft", form_date: "2026-10-14", coaching_details: coachingDetails },
    checked: {},
    error: null,
  }) as never;

describe("step-b-refusals LIVE: sun-late-date's policy ask", () => {
  const updated = "Updated the **Coaching Form** for **Thaddeus Lowestoft**: Details of Coaching. Everything else on the form is as it was.";

  it("fails when Details is about showing up late but the policy is ignored", () => {
    expect(lateDate.expect.check(run("Observed:\nThaddeus showed up late.", updated))).toMatch(/please list the policy/);
  });

  it("passes when the policy appears in Details", () => {
    expect(lateDate.expect.check(run("Observed:\nThaddeus showed up late.\n\nPolicy reference: Attendance Policy", updated))).toBeNull();
  });

  it("passes when the reply says where the policy goes", () => {
    expect(lateDate.expect.check(run("Observed:\nThaddeus showed up late.", `${updated} Which policy should I list?`))).toBeNull();
  });

  it("is live only: the replay run's check is unchanged (its model text is the script's)", () => {
    const scripted = STEP_B_REFUSAL_SCENARIOS.find((scenario) => scenario.id === "sun-late-date")!;
    expect(scripted.expect.check(run("Observed:\nThaddeus showed up late.", updated))).toBeNull();
  });
});
