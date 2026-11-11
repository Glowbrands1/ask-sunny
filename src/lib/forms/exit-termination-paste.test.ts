import { afterEach, describe, expect, it, vi } from "vitest";

import { readExitDetails } from "./exit-details";
import { readExitFacts } from "./exit-facts";

/**
 * QA, 5 Nov 2026 (severe, this app's production): a salon director pasted a termination letter and asked for an
 * exit form. The card said How Employee Resigned "Text message" (the text message that CAUSED the termination),
 * Salon Key Returned "Salon key was returned" (the letter tells the employee to return them "today 11/06" — and,
 * earlier, quotes "you would turn in your keys"), and Last Day Worked 5 Nov ("your final paycheck, including all
 * hours worked through 11/05/2026"). An Exit field is filled only from what the manager said HAPPENED: a
 * termination is not a resignation; a future or conditional return is not a return; a pay period is not a last
 * day. The manager's words; every person invented (checked against both apps' directories).
 */
const PASTE = [
  "I need an exit form with this information. Meeting with Dorran tomorrow 11/06 at 7:30am ",
  "",
  "    This decision follows the text message you sent to your Salon Director on 11/05, in which you said that if you were asked to clean up a toilet overflow, you would turn in your keys.",
  "    Cleaning up this kind of incident is part of the job. We covered it in our recent safety training, including the correct PPE and cleanup steps, and it is a requirement for STC.",
  "    The tone of the message was also disrespectful to your Salon Director, Philippa.",
  "    We expect every team member to treat our Salon Directors with respect, and we are not able to continue working with you.",
  "",
  "",
  "This meeting confirms that your employment with Sun Tan City is terminated, effective 11/06/2026.",
  "",
  "Please return your salon keys and any other company property today 11/06. Your final paycheck, including all hours worked through 11/05/2026, will be issued on 11/27/2026.",
].join("\n");
const TODAY = "2026-11-05";

const read = () => {
  const facts = readExitFacts(PASTE, TODAY);
  return { facts, details: readExitDetails(PASTE, TODAY, facts) };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("EXIT_STATED_ONLY_ENABLED off: as before (the bug)", () => {
  it("the termination letter fills How Employee Resigned, Salon Key Returned and Last Day Worked", () => {
    const { facts, details } = read();
    expect(details.resignationMethod).toBe("Text message");
    expect(details.answers.salon_key_returned).toBe("yes");
    expect(facts.lastDayWorked).toBe("2026-11-05");
  });
});

describe("EXIT_STATED_ONLY_ENABLED on: an Exit field only from what the manager said happened", () => {
  it("a termination is not a resignation: How Employee Resigned stays blank", () => {
    vi.stubEnv("EXIT_STATED_ONLY_ENABLED", "true");
    expect(read().details.resignationMethod).toBeNull();
  });

  it("\"Please return your salon keys … today 11/06\" and \"you would turn in your keys\" are not a key returned", () => {
    vi.stubEnv("EXIT_STATED_ONLY_ENABLED", "true");
    expect(read().details.answers.salon_key_returned).toBeUndefined();
  });

  it("\"all hours worked through 11/05/2026\" on the final paycheck is a pay period, not the Last Day Worked", () => {
    vi.stubEnv("EXIT_STATED_ONLY_ENABLED", "true");
    expect(read().facts.lastDayWorked).toBeNull();
  });

  it("negative: a resignation by text, a key dropped off and a last day said outright are still read", () => {
    vi.stubEnv("EXIT_STATED_ONLY_ENABLED", "true");
    const text = "She texted me Sunday that she was quitting. Her last day worked was 11/2. She dropped off her key but still has her shirts.";
    const facts = readExitFacts(text, TODAY);
    const details = readExitDetails(text, TODAY, facts);
    expect(details.resignationMethod).toBe("Text message");
    expect(details.answers.salon_key_returned).toBe("yes");
    expect(details.answers.store_items_returned).toBe("no");
    expect(facts.lastDayWorked).toBe("2026-11-02");
  });

  it("negative: \"she worked through 11/2 and then quit\" is still her last day", () => {
    vi.stubEnv("EXIT_STATED_ONLY_ENABLED", "true");
    expect(readExitFacts("she worked through 11/2 and then quit by text", TODAY).lastDayWorked).toBe("2026-11-02");
  });
});
