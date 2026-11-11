import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isAdviceAsk, withoutAppInstructions } from "./app-instructions";

/* ADVICE_ASK_NOT_ACCOUNT_ENABLED. Pau's P14 wording verbatim. The replay case runs the route. */
const TURN_1 =
  "i have a girl upset that i am coaching on how to updateclients checking accounts and they think that our job is to serve them and not update their info. how i do about her frusteration";
const TURN_3 = "tell me how what to say back. send a messageto me";

describe("ADVICE_ASK_NOT_ACCOUNT_ENABLED", () => {
  /*
   * QA (11 Nov 2026, before the flip): each test starts with both flags unset, whatever the env says, and the env's own
   * values go back after. APP_INSTRUCTIONS_NOT_ACCOUNT is on in production: restored, never deleted.
   */
  const FLAGS = ["ADVICE_ASK_NOT_ACCOUNT_ENABLED", "APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED"] as const;
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const name of FLAGS) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });
  afterEach(() => {
    for (const name of FLAGS) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("off: the turns are as they are", () => {
    expect(withoutAppInstructions(TURN_1)).toBe(TURN_1);
    expect(withoutAppInstructions(TURN_3)).toBe(TURN_3);
  });

  it("on: the asks go, the account stays", () => {
    process.env.ADVICE_ASK_NOT_ACCOUNT_ENABLED = "true";
    expect(withoutAppInstructions(TURN_1)).toBe(
      "i have a girl upset that i am coaching on how to updateclients checking accounts and they think that our job is to serve them and not update their info.",
    );
    expect(withoutAppInstructions(TURN_3).trim()).toBe("");
  });

  it.each(["How do I handle this?", "what should i say to her", "Any advice", "can you help me word this", "how to respond to her"])(
    "on: %s is an ask",
    (said) => {
      process.env.ADVICE_ASK_NOT_ACCOUNT_ENABLED = "true";
      expect(isAdviceAsk(said)).toBe(true);
    },
  );

  it.each([
    "How she spoke to the guest was rude.",
    "she told me what to do with the register and walked out.",
    "i have a girl upset that i am coaching on how to updateclients checking accounts",
    "She asked how to clock in and still did not clock in.",
  ])("on, account: %s", (said) => {
    process.env.ADVICE_ASK_NOT_ACCOUNT_ENABLED = "true";
    expect(isAdviceAsk(said)).toBe(false);
  });

  it("on with APP_INSTRUCTIONS_NOT_ACCOUNT: both kinds go", () => {
    process.env.ADVICE_ASK_NOT_ACCOUNT_ENABLED = "true";
    process.env.APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED = "true";
    expect(withoutAppInstructions("she was late. Please word it in a professional way. how do i talk to her").trim()).toBe("she was late.");
  });
});
