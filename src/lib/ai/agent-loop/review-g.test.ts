import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { dictatedActionPlan, exactWarningLevel, exitIsTermination, FORM_DATE_NAMED } = await import("./tools");

/* QA's review of batch G (15 Nov 2026), items 3–6. Invented names only. */

describe("an exit stated as a termination (item 3)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = () => vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
  it.each([
    "terminate remy calder, 3 no call no shows on 11/10, 11/12 and 11/13",
    "exit form for remy calder, termination effective 11/20, not eligible for rehire, no call no show 3 shifts",
    "we're terminating her, last day 11/14",
    "exit form, involuntary separation",
  ])("reads %s as a termination", async (text) => {
    on();
    expect(await exitIsTermination(text)).toBe(true);
  });
  it.each([
    "exit form for remy calder, she gave notice, last day 11/28. Not a termination.",
    "She quit. She was fired from her last job btw",
    "exit form for remy calder, she resigned, let her go home early today",
    "exit form for remy calder, she resigned, we might terminate her otherwise",
    "should this be a termination?",
  ])("never reads %s as a termination", async (text) => {
    on();
    expect(await exitIsTermination(text)).toBe(false);
  });
  it("off: never a termination", async () => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "false");
    expect(await exitIsTermination("terminate her, last day 11/14")).toBe(false);
  });
});

describe("the form's own date, named as such (item 4)", () => {
  it.each(["change date of document to 11-15-2026", "the form date should be 11/20", "change the date on the form to 11/20", "date this form 11/20", "change the date to 12/20/2026"])("%s names the form's date", (text) => {
    expect(FORM_DATE_NAMED.test(text)).toBe(true);
  });
  it.each(["wrong date, she was late on 11/20", "the date she was late was 11/20", "update the date to 11/20, she was late that day", "change the date to 11/20 because she was late then"])("%s does not", (text) => {
    expect(FORM_DATE_NAMED.test(text)).toBe(false);
  });
});

describe("a warning level is an exact value (item 5)", () => {
  it.each([["verbal", "verbal"], ["Written", "written"], [" termination ", "termination"]] as const)("%s is %s", (value, level) => {
    expect(exactWarningLevel(value)).toBe(level);
  });
  it.each(["written termination", "termination warning", "verbal warning", "demotion", "final written"])("%s is refused", (value) => {
    expect(exactWarningLevel(value)).toBeNull();
  });
});

describe("a dictated Action Plan only where the message marks it (item 6)", () => {
  it("after an \"Action Plan:\" label, as the manager typed it", () => {
    expect(dictatedActionPlan("Action Plan: Violation of Company policy has resulted in immediate termination of employment.")).toBe("Violation of Company policy has resulted in immediate termination of employment.");
  });
  it("after \"the action plan section … needs to reflect the following verbage:\"", () => {
    expect(dictatedActionPlan("The action plan section of the form needs to reflect the following verbage: Violation of Company policy has resulted in immediate termination of employment.")).toBe("Violation of Company policy has resulted in immediate termination of employment.");
  });
  it("after \"change the action plan to …\", in the manager's own capitals", () => {
    expect(dictatedActionPlan("change the action plan to She will Review the Attendance policy with her DM")).toBe("She will Review the Attendance policy with her DM");
  });
  it.each(["she was late on 11/12 and didn't call the salon", "add that she was late again on 11/13", "the plan is fine, she was late twice"])("%s marks no plan", (text) => {
    expect(dictatedActionPlan(text)).toBeNull();
  });
});
