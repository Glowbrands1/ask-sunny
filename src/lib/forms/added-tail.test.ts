import { describe, expect, it } from "vitest";

import { addedTail } from "./added-tail";

const OLD = "Observed:\nOttoline Ormsworth was late on 11/5/26.\n\nExpectation:\nOttoline is expected to arrive on time.";

describe("addedTail (ADD_NOT_REPEATED, QA's live round 15 in Ask Bubbles)", () => {
  it("the field's text run onto one line, then the new sentence: only the new sentence", () => {
    expect(addedTail(OLD, "Observed: Ottoline Ormsworth was late on 11/5/26. Expectation: Ottoline is expected to arrive on time. Ottoline was reminded of the policy.")).toBe(
      "Ottoline was reminded of the policy.",
    );
  });
  it("the field's text as it is, then the new sentence", () => {
    expect(addedTail(OLD, `${OLD}\nOttoline was reminded of the policy.`)).toBe("Ottoline was reminded of the policy.");
  });
  it("a new sentence alone is not a repeat", () => {
    expect(addedTail(OLD, "Ottoline was reminded of the policy.")).toBeNull();
  });
  it("the field's text changed on the way is not a repeat", () => {
    expect(addedTail(OLD, "Observed: Ottoline Ormsworth was late on 11/6/26. Expectation: on time. Reminded.")).toBeNull();
  });
  it("the field's text alone adds nothing", () => {
    expect(addedTail(OLD, OLD.replace(/\n/g, " "))).toBeNull();
  });
  describe("QA's live Bubbles r15b: the add repeats the field's first sentence", () => {
    const CA = "Observed:\nWrenna Thistlecombe was late to work on October 23, 2026.\n\nExpectation:\nWrenna is expected to arrive on time.\n\nGoing Forward:\nWrenna will arrive on time.";
    const ON = { sentences: true } as const;
    it("with ADD_NOT_REPEATED_SENTENCES off, as before: a repeated first sentence is not read as a repeat", () => {
      expect(addedTail(CA, "Observed: Wrenna Thistlecombe was late to work on October 23, 2026. Wrenna was also on her phone.")).toBeNull();
    });
    it("the Observed heading and sentence, then the new one: only the new one", () => {
      expect(addedTail(CA, "Observed: Wrenna Thistlecombe was late to work on October 23, 2026. Wrenna was also on her phone.", ON)).toBe("Wrenna was also on her phone.");
    });
    it("the first sentence without its heading, on its own line", () => {
      expect(addedTail(CA, "Wrenna Thistlecombe was late to work on October 23, 2026.\nWrenna was also on her phone.", ON)).toBe("Wrenna was also on her phone.");
    });
    it("a heading alone is not a repeated sentence", () => {
      expect(addedTail(CA, "Observed: Wrenna was also on her phone.", ON)).toBeNull();
    });
    it("a sentence that changed on the way is not a repeat", () => {
      expect(addedTail(CA, "Observed: Wrenna Thistlecombe was late to work on October 24, 2026. Wrenna was also on her phone.", ON)).toBeNull();
    });
    it("a date inside a sentence does not end it", () => {
      expect(addedTail("Observed:\nWrenna was late on 10/23/26 at 9.30 am.", "Wrenna was late on 10/23/26 at 9.30 am. She was on her phone.", ON)).toBe("She was on her phone.");
    });
  });
  it("QA's gate: the whole field with the new line inside it is left as it is (no Expectation saved twice)", () => {
    const old = "Observed:\nWrenna Thistlecombe missed the October 15, 2026 Woven deadline.\nExpectation:\nWoven deadlines are met on time.";
    const value = "Observed:\nWrenna Thistlecombe missed the October 15, 2026 Woven deadline.\nAlso observed: Wrenna was on her phone.\nExpectation:\nWoven deadlines are met on time.";
    expect(addedTail(old, value, { sentences: true })).toBeNull();
  });
});
