import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { dictatedActionPlan, exactWarningLevel } = await import("./tools");

/* QA's design for batch G (15 Nov 2026): code only locks what the model decided. Invented names only. */

describe("a warning level is an exact value", () => {
  it.each([["verbal", "verbal"], ["Written", "written"], [" termination ", "termination"]] as const)("%s is %s", (value, level) => {
    expect(exactWarningLevel(value)).toBe(level);
  });
  it.each(["written termination", "termination warning", "verbal warning", "demotion", "final written"])("%s is refused", (value) => {
    expect(exactWarningLevel(value)).toBeNull();
  });
});

describe("the dictated Action Plan lock (item E)", () => {
  const PLAN = "Violation of Company policy has resulted in immediate termination of employment.";
  it("after an \"Action Plan:\" label: the message's own stretch, as the manager typed it", () => {
    expect(dictatedActionPlan(`Action Plan: ${PLAN}`, PLAN.toLowerCase())).toBe(PLAN);
  });
  it("after \"the action plan section … needs to reflect the following verbage:\"", () => {
    expect(dictatedActionPlan(`The action plan section of the form needs to reflect the following verbage: ${PLAN}`, PLAN)).toBe(PLAN);
  });
  it("after \"change the action plan to …\", in the manager's own capitals and spacing squashed", () => {
    expect(dictatedActionPlan("change the action plan to She will Review  the Attendance policy with her DM", "she will review the attendance policy with her DM")).toBe("She will Review  the Attendance policy with her DM");
  });
  it("the model sets the bounds: \"Also make it a written\" after the plan stays out", () => {
    expect(dictatedActionPlan(`Action Plan: ${PLAN} Also make it a written.`, PLAN)).toBe(PLAN);
  });
  it.each([
    ["leave the action plan alone, she was late on 11/12 and didn't call the salon", "she was late on 11/12 and didn't call the salon"],
    ["she was late on 11/12, add it", "she was late on 11/12"],
    [`Action Plan: ${PLAN}`, "She will review the policy with her DM."],
    ["Action Plan: short", "short"],
  ])("%s with the model's %s is no dictated plan", (message, text) => {
    expect(dictatedActionPlan(message, text)).toBeNull();
  });
});
