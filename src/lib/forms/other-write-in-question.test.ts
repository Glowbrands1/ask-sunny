import { afterEach, describe, expect, it } from "vitest";

import { managerIssueWords } from "./other-write-in";

/** QA, 30 Oct 2026: the earlier turn's question became the Other topic. */
const FLAG = "OTHER_WRITE_IN_NOT_A_QUESTION_ENABLED";
const NOTES = "Which forms can I create here?\n\ncreate a coaching form for jordan testperson at kearney, he was late on 10/20";
const before = process.env[FLAG];
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

describe("managerIssueWords never takes a question the manager asked", () => {
  it("off: the question is read as what happened (as before)", () => {
    delete process.env[FLAG];
    expect(managerIssueWords(NOTES)).toBe("Which forms can I create here");
  });

  it("on: the account after the request", () => {
    process.env[FLAG] = "true";
    expect(managerIssueWords(NOTES)).toBe("He was late on 10/20");
  });

  it("on: the same question typed without its question mark", () => {
    process.env[FLAG] = "true";
    expect(managerIssueWords(NOTES.replace("?", ""))).toBe("He was late on 10/20");
  });

  it.each(["Does not clock in on time", "Can't keep her station clean", "When she arrived she was on her phone"])(
    "on: an account that starts like a question is kept: %s",
    (said) => {
      process.env[FLAG] = "true";
      expect(managerIssueWords(said)).toBe(said);
    },
  );
});
