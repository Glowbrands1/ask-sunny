import { afterEach, describe, expect, it, vi } from "vitest";

import { managerWordsObservation } from "./draft-never-blank";

/*
 * REQUEST_LINE_ACCOUNT_ENABLED with QA's D2 words (26 Oct 2026): the request
 * sentence's account and the coaching sentence after it are both the
 * manager's words. The fallback names the coaching in What happened, which QA
 * accepted as long as every date stays as the manager typed it. With the flag
 * off the fallback was only the coaching sentence.
 */
const D2 = "create a ca for quinn marlowe at kearney, she was late on 10-5 and 10-15. i coached her on 10-16 about being late";

afterEach(() => vi.unstubAllEnvs());

describe("REQUEST_LINE_ACCOUNT_ENABLED: D2's fallback keeps the dates", () => {
  it.each([
    ["lowercase", D2],
    ["Sentence case", "Create a CA for Quinn Marlowe at Kearney, she was late on 10-5 and 10-15. I coached her on 10-16 about being late"],
  ])("%s", (_casing, notes) => {
    vi.stubEnv("REQUEST_LINE_ACCOUNT_ENABLED", "1");
    const observed = managerWordsObservation(notes, "quinn marlowe") ?? "";
    expect(observed).toMatch(/^Observed:\n[Ss]he was late on 10-5 and 10-15\. I coached her on 10-16 about being late\.$/i);
  });

  it("off, as main: only the coaching sentence", () => {
    vi.stubEnv("REQUEST_LINE_ACCOUNT_ENABLED", "");
    expect(managerWordsObservation(D2, "quinn marlowe")).toBe("Observed:\nI coached her on 10-16 about being late.");
  });
});
