import { describe, expect, it } from "vitest";

import { saysTerminationWord, statesTerminationWordNow } from "./termination-word";

/* QA's design (15 Nov 2026): the lock only looks for a termination word; the model decides what it means. */
describe("the termination word lock", () => {
  it.each(["we're terminating her", "termination CA for Wren Halloway", "term CA for her", "term c/a", "we fired her today", "fire him", "she fires up the beds", "I'm firing him"])("%s carries a termination word", (text) => {
    expect(saysTerminationWord(text)).toBe(true);
  });
  it.each(["she no call no showed on 11/12", "write her up, she was late again", "let her go home early", "final written warning", "she was a no show"])("%s carries none", (text) => {
    expect(saysTerminationWord(text)).toBe(false);
  });
  it("a question never passes edit_form's lock", () => {
    expect(statesTerminationWordNow("should this be a termination?")).toBe(false);
    expect(statesTerminationWordNow("make it a termination")).toBe(true);
  });
});
