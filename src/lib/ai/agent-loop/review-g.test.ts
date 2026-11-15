import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { dictatedActionPlan, exactWarningLevel, lockedExitDate, priorActionsProblem } = await import("./tools");

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

/* Batch G2 (item 4, QA's live run part 2, T6): prior actions keep the stated count and never take this incident's date. */
describe("the prior-actions lock", () => {
  const said = "write a CA for Remy Calder, after two prior written warnings she was late again today";
  it("refuses this incident's date on an earlier step", () => {
    expect(priorActionsProblem("Written warning — 11/14/2026", said, "2026-11-14")?.reason).toMatch(/this incident's date/);
  });
  it("refuses a date the manager never gave", () => {
    expect(priorActionsProblem("Written warning (2) — 10/02/2026", said, "2026-11-14")?.reason).toMatch(/not a date the manager gave/);
  });
  it("refuses a lost count", () => {
    expect(priorActionsProblem("Written warning, date not given", said, "2026-11-14")).toEqual({ reason: "the manager said 2 earlier steps", count_said: 2 });
  });
  it("keeps the count with no dates, and a date the manager attached", () => {
    expect(priorActionsProblem("Written warning (2), dates not given", said, "2026-11-14")).toBeNull();
    expect(priorActionsProblem("Verbal CA — 10/02/2026", "ca for remy calder, she had a verbal on 10/2/2026, late again today", "2026-11-14")).toBeNull();
    // QA: "a termination warning in March" in Prior actions is history, and is kept.
    expect(priorActionsProblem("Termination warning — March", "she got a termination warning in March. Now she was late again, make a CA", "2026-11-14")).toBeNull();
  });
});

/* Batch G2 item 7: the level a tool-less reply states, and its "nothing changed" words. */
describe("statedLevel and SAYS_NOTHING_CHANGED (batch G2 item 7)", async () => {
  const { statedLevel, SAYS_NOTHING_CHANGED } = await import("./run");
  it("reads the level a reply states, Termination included", () => {
    expect(statedLevel("The form still shows Written Warning — nothing was changed.")).toBe("written");
    expect(statedLevel("**Type of Warning:** Termination, as you said")).toBe("termination");
    expect(statedLevel("It's a Termination on the draft.")).toBe("termination");
    expect(statedLevel("I changed it back to a verbal.")).toBe("verbal");
    expect(statedLevel("Here's the Corrective Action Form for **Remy Calder**.")).toBeNull();
  });
  it("reads the nothing-changed words", () => {
    for (const reply of ["nothing was changed", "There's nothing to undo", "The draft still shows Termination", "No changes were made."]) expect(SAYS_NOTHING_CHANGED.test(reply), reply).toBe(true);
    expect(SAYS_NOTHING_CHANGED.test("The form now shows **Written**.")).toBe(false);
  });
});
