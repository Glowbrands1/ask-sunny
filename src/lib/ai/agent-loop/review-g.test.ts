import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { dictatedActionPlan, exactWarningLevel, lockedExitDate } = await import("./tools");

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
    // QA's third review: a comma, period or semicolon ends the "action plan … :" marker.
    ["Leave the action plan alone, add to the observation: she left 20 minutes early", "she left 20 minutes early"],
    ["leave the action plan alone, add to the observation: she left 20 minutes early on 11/12", "she left 20 minutes early on 11/12"],
    ["don't touch the action plan. Add this to observation: she left 20 minutes early on 11/12", "she left 20 minutes early on 11/12"],
  ])("%s with the model's %s is no dictated plan", (message, text) => {
    expect(dictatedActionPlan(message, text)).toBeNull();
  });
});

/* QA's third review (items 5 and 6): the exit's date the model passes, kept only when the manager typed that day. */
describe("the exit's locked date", () => {
  it("keeps a typed date with its year, or the nearest day to today", () => {
    expect(lockedExitDate("11/28", "terminate her, termination date 11/28", "2026-11-15")).toBe("2026-11-28");
    expect(lockedExitDate("2026-11-12", "we fired her on 11/12, exit form", "2026-11-15")).toBe("2026-11-12");
    expect(lockedExitDate("11/20", "terminated as of 11/20", "2026-11-15")).toBe("2026-11-20");
    expect(lockedExitDate("1/5", "termination effective 1/5", "2026-12-30")).toBe("2027-01-05");
    expect(lockedExitDate("12/28", "we fired her on 12/28", "2027-01-02")).toBe("2026-12-28");
    expect(lockedExitDate("11/20/2027", "terminated as of 11/20/2027", "2026-11-15")).toBe("2027-11-20");
  });
  it("drops a date the manager never typed, and passes nothing when the model passed none", () => {
    expect(lockedExitDate("11/30", "terminate her, termination date 11/28", "2026-11-15")).toBeNull();
    expect(lockedExitDate(undefined, "terminate her, termination date 11/28", "2026-11-15")).toBeNull();
    expect(lockedExitDate("", "terminate her", "2026-11-15")).toBeNull();
  });
});
