import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readExitDetails } from "./exit-details";
import { readExitFacts } from "./exit-facts";

// EXIT_TERMINATION_STATED_ENABLED (QA's Sunny round-5 live tester, 8 Nov 2026, item 4).
const TODAY = "2026-11-05";
const LETTER =
  "This decision follows the text message you sent to your Salon Director on 11/05, in which you said you would turn in your keys. " +
  "This meeting confirms that your employment with Sun Tan City is terminated, effective 11/06/2026. " +
  "Please return your salon keys and any other company property today 11/06. Your final paycheck, including all hours worked through 11/05/2026, will be issued on 11/27/2026.";

beforeEach(() => {
  vi.stubEnv("EXIT_STATED_ONLY_ENABLED", "true");
  vi.stubEnv("EXIT_TERMINATION_STATED_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("EXIT_TERMINATION_STATED_ENABLED", () => {
  it("off: the letter states no separation, no date and no reason", () => {
    vi.stubEnv("EXIT_TERMINATION_STATED_ENABLED", "");
    const facts = readExitFacts(LETTER, TODAY);
    expect(facts.typeOptions).toEqual([]);
    expect(facts.resignationDate).toBeNull();
    expect(readExitDetails(LETTER, TODAY).resignationReason).toBeNull();
  });

  it("on: the termination, its effective date and the stated reason; no last day from a pay line", () => {
    const facts = readExitFacts(LETTER, TODAY);
    expect(facts.typeOptions.length).toBe(1);
    expect(facts.resignationDate).toBe("2026-11-06");
    expect(facts.lastDayWorked).toBeNull();
    const details = readExitDetails(LETTER, TODAY);
    // QA's round-6 follow-up (8 Nov 2026): the letter's "you" is about the employee on the form.
    expect(details.resignationReason).toBe(
      "The text message the employee sent to their Salon Director on 11/05, in which they said they would turn in their keys.",
    );
    expect(details.resignationMethod).toBeNull();
  });

  it.each([
    "should your employment be terminated, effective 11/06/2026?",
    "your employment will be terminated, effective 11/06/2026, if this happens again.",
    "your employment is not terminated.",
  ])("%s: no separation", (said) => {
    const facts = readExitFacts(said, TODAY);
    expect(facts.typeOptions).toEqual([]);
    expect(facts.resignationDate).toBeNull();
  });

  it.each([
    ["you're repeatedly late and we told you twice", "The employee is repeatedly late and we told them twice."],
    ["your conduct toward a guest, which you were warned about", "The employee's conduct toward a guest, which they were warned about."],
  ])("the reason is about the employee, never \"you\": %s", (said, reason) => {
    const letter = `This decision follows ${said}. Your employment is terminated, effective 11/06/2026.`;
    expect(readExitDetails(letter, TODAY).resignationReason).toBe(reason);
  });

  it("an explicit last day still fills Last Day Worked", () => {
    expect(readExitFacts(`${LETTER} Her last day worked was 11/05/2026.`, TODAY).lastDayWorked).toBe("2026-11-05");
  });
});
