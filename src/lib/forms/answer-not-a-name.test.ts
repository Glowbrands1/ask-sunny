import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { namesSomebody } from "./answer-not-a-name";
import { isDateAnswerWords } from "./incident-dates";
import { readEmployeeMentions } from "./proposal";

/*
 * ANSWER_NOT_A_NAME_ENABLED: only a payroll or date ANSWER stops being a name.
 * A person whose name looks like one stays a person. Invented names only.
 */
const FLAGS = ["ANSWER_NOT_A_NAME_ENABLED", "PAYROLL_TYPO_NOT_A_NAME_ENABLED", "DATE_ANSWER_APPLIED_ENABLED"];
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of FLAGS) {
    saved.set(name, process.env[name]);
    process.env[name] = "true";
  }
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("namesSomebody", () => {
  it.each(["payrol ldeduct", "Payrol Ldeduct", "payroll deduct", "most recent", "Most Recent", "the latest"])(
    "%s is an answer, not a name",
    (answer) => {
      expect(namesSomebody(answer)).toBe(false);
    },
  );

  it.each(["payton rolls", "Payton Rolls", "Roll", "Dale Ferris", "Mara Quill", "Most Recent Smith", "Rory Vance"])(
    "%s is still somebody",
    (name) => {
      expect(namesSomebody(name)).toBe(true);
    },
  );

  it("keeps every candidate with the flag off", () => {
    delete process.env.ANSWER_NOT_A_NAME_ENABLED;
    expect(namesSomebody("payrol ldeduct")).toBe(true);
    expect(namesSomebody("most recent")).toBe(true);
  });
});

describe("the date answers match incident-dates.ts", () => {
  it.each(["most recent", "Most Recent", "the latest", "latest", "newest", "last one", "first", "earliest", "oldest", "second one", "Most Recent Smith", "Dale Ferris", "recent"])(
    "%s",
    (words) => {
      expect(!namesSomebody(words)).toBe(isDateAnswerWords(words));
    },
  );
});

describe("readEmployeeMentions with the flag on", () => {
  it.each(["yes payrol ldeduct", "Yes payrol ldeduct", "most recent", "Most recent"])("%s names nobody", (turn) => {
    const mentions = readEmployeeMentions(turn);
    expect(JSON.stringify(mentions).toLowerCase()).not.toMatch(/payrol|most recent/);
  });

  it.each([
    ["Mara Quill was late", "mara quill"],
    ["Dale Ferris was late", "dale ferris"],
  ])("%s still names the employee", (turn, name) => {
    expect(JSON.stringify(readEmployeeMentions(turn)).toLowerCase()).toContain(name);
  });
});
