import { afterEach, describe, expect, it } from "vitest";

import { isAppInstruction, withoutAppInstructions } from "./app-instructions";

/*
 * APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED. The manager's words are verbatim (QA's P12 part 2, Sunny production, 6 Nov
 * 2026); the person is invented. The replay cases `nov10-p12-three-requests-t1…t3` run the chat.
 */
const SAID =
  "Can you create me a coaching document for Brisa Talvenor for not hitting her numbers for the month of October. Please word it in a professional way. I need the policy attached as well.";

afterEach(() => {
  delete process.env.APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED;
});

describe("instructions to the app", () => {
  it("read the wording and policy asks, never an account", () => {
    expect(isAppInstruction("Please word it in a professional way.")).toBe(true);
    expect(isAppInstruction("I need the policy attached as well.")).toBe(true);
    expect(isAppInstruction("please include the attendance policy")).toBe(true);
    expect(isAppInstruction("She violated the attendance policy twice.")).toBe(false);
    expect(isAppInstruction("She was not professional with a guest.")).toBe(false);
  });

  it("are left out with the flag on, the account kept; as before off", () => {
    expect(withoutAppInstructions(SAID)).toBe(SAID);
    process.env.APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED = "true";
    expect(withoutAppInstructions(SAID)).toBe(
      "Can you create me a coaching document for Brisa Talvenor for not hitting her numbers for the month of October.",
    );
  });
});
