import { describe, expect, it } from "vitest";

import { managerTypedActionPlan, replyWithManagerActionPlan } from "./manager-action-plan";

const PLAN = "complete the Woven policy module by 10-30-26 and review it with her manager";

describe("managerTypedActionPlan", () => {
  it("reads the plan after the label, word for word", () => {
    expect(
      managerTypedActionPlan(
        `create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline. action plan: ${PLAN}`,
      ),
    ).toBe(PLAN);
    expect(managerTypedActionPlan(`Action Plan - ${PLAN}`)).toBe(PLAN);
    expect(managerTypedActionPlan(`the action plan is ${PLAN}`)).toBe(PLAN);
    expect(managerTypedActionPlan(`her plan is to ${PLAN}`)).toBe(PLAN);
    expect(managerTypedActionPlan(`plan of action: ${PLAN}.`)).toBe(`${PLAN}.`);
  });

  it("is null when no plan was typed", () => {
    expect(
      managerTypedActionPlan("create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline"),
    ).toBeNull();
    expect(managerTypedActionPlan("what should the action plan be?")).toBeNull();
    expect(managerTypedActionPlan("action plan: none")).toBeNull();
    expect(managerTypedActionPlan("the action plan is blank")).toBeNull();
    expect(managerTypedActionPlan("payroll plan: no")).toBeNull();
    expect(managerTypedActionPlan("remove the action plan")).toBeNull();
  });

  it("keeps a plan of several sentences and stops at a sentence that gives another slot", () => {
    expect(managerTypedActionPlan(`action plan: ${PLAN}. Then sign the acknowledgement. No payroll deduct.`)).toBe(
      `${PLAN}. Then sign the acknowledgement.`,
    );
    expect(managerTypedActionPlan(`action plan: ${PLAN}\nverbal`)).toBe(PLAN);
  });

  it("takes the last plan stated", () => {
    expect(managerTypedActionPlan(["action plan: retrain on Woven", `action plan: ${PLAN}`])).toBe(PLAN);
  });
});

describe("replyWithManagerActionPlan", () => {
  const STANDARD =
    "**Action Plan:** Management will review the Standards of Conduct policy with Test. Future policy violations may result in additional corrective action up to and including termination of employment.";

  it("takes the standard plan off the reply when none was typed", () => {
    const content = `I'll draft a **Corrective Action Form** for **Test Employee**.\n\n${STANDARD}\n\nIs payroll deduct applicable?`;
    expect(replyWithManagerActionPlan(content, ["create a written CA for Test Employee"], "Action Plan")).toBe(
      "I'll draft a **Corrective Action Form** for **Test Employee**.\n\nIs payroll deduct applicable?",
    );
  });

  it("puts the manager's plan where the standard one was", () => {
    const content = `Intro.\n\n${STANDARD}\n\nIs payroll deduct applicable?`;
    expect(replyWithManagerActionPlan(content, [`action plan: ${PLAN}`], "Action Plan")).toBe(
      `Intro.\n\n**Action Plan:** ${PLAN}\n\nIs payroll deduct applicable?`,
    );
  });

  it("adds the manager's plan at the end when the reply had none, and leaves a reply without one alone", () => {
    expect(replyWithManagerActionPlan("Intro.", [`action plan: ${PLAN}`], "Action Plan")).toBe(
      `Intro.\n\n**Action Plan:** ${PLAN}`,
    );
    expect(replyWithManagerActionPlan("Intro.", ["no plan here"], "Action Plan")).toBe("Intro.");
  });
});
