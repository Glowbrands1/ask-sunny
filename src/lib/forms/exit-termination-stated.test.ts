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
    expect(details.resignationReason).toMatch(/^The text message you sent/);
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

  it("an explicit last day still fills Last Day Worked", () => {
    expect(readExitFacts(`${LETTER} Her last day worked was 11/05/2026.`, TODAY).lastDayWorked).toBe("2026-11-05");
  });
});
