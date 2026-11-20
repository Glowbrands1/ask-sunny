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
  /* QA item 12 (20 Nov 2026, live): HR shorthand for a termination. */
  it.each(["involuntary immediate term", "immediate term", "involuntary", "termed her today", "involuntary term", "we let her go today", "she was let go", "separated from employment 11/20", "job abandonment", "no call no show x3", "3 ncns", "three no call no shows"])("%s carries a termination word", (text) => {
    expect(saysTerminationWord(text)).toBe(true);
  });
  it.each(["voluntary resignation", "long term goals", "short-term fix", "the terms of her schedule", "let her go home early", "let her go on break", "she separated the towels", "no call no show on 11/12"])("%s carries none", (text) => {
    expect(saysTerminationWord(text)).toBe(false);
  });
  it("a question never passes edit_form's lock", () => {
    expect(statesTerminationWordNow("should this be a termination?")).toBe(false);
    expect(statesTerminationWordNow("make it a termination")).toBe(true);
  });
});
