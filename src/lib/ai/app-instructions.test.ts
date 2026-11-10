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

  it("a team card's turn: the marker, the request lead and the Employee-field instruction are no account (QA, round 17)", () => {
    const team = "make me a coaching form for the team at Pine Lake on selling lotion bottles";
    const marked = `Coaching Form for the whole team at NE Lincoln Pine Lake: ${team}`;
    expect(withoutAppInstructions(marked)).toBe(marked);
    expect(withoutAppInstructions("the employee needs to be left blank")).toBe("the employee needs to be left blank");
    process.env.APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED = "true";
    expect(withoutAppInstructions(marked)).toBe("The team at Pine Lake on selling lotion bottles");
    expect(withoutAppInstructions(team)).toBe("The team at Pine Lake on selling lotion bottles");
    expect(withoutAppInstructions("the employee needs to be left blank").trim()).toBe("");
    // One person's request keeps its lead: the account is read after the name, as before.
    expect(withoutAppInstructions("make me a coaching form for Brisa Talvenor not hitting October numbers")).toBe(
      "make me a coaching form for Brisa Talvenor not hitting October numbers",
    );
  });
});
