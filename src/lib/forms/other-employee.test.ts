import { describe, expect, it } from "vitest";

import { namesAnotherEmployee, namingTheForm, typedPeopleAfterFor } from "./other-employee";

describe("a turn about another employee's form (DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED)", () => {
  const SECOND = "now one for Test Employee Two at Kearney for being late on 10-20-26";

  it("reads the typed person whole: Test Employee Two, not Test", () => {
    expect(typedPeopleAfterFor(SECOND)).toEqual(["Test Employee Two"]);
    expect(namesAnotherEmployee(SECOND, "Test Employee")).toBe(true);
  });

  it("the same employee, or an account with no person after 'for', is not another employee", () => {
    expect(namesAnotherEmployee("now one for Test Employee at Kearney for being late on 10-22-26", "Test Employee")).toBe(false);
    expect(namesAnotherEmployee("she was late on 10-20-26 for the second time", "Test Employee")).toBe(false);
    expect(namesAnotherEmployee("add that she was also on her phone", "Test Employee")).toBe(false);
  });

  it("names the form in place of 'one'", () => {
    expect(namingTheForm(SECOND, "Corrective Action Form")).toBe(
      "a Corrective Action Form for Test Employee Two at Kearney for being late on 10-20-26",
    );
    expect(namingTheForm("add that she was also on her phone", "Corrective Action Form")).toBe("add that she was also on her phone");
  });
});

/*
 * QA-6, 26 Oct 2026. Two findings on the reader above, both behind
 * DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED (its only callers, `other-employee-form.ts`
 * and `proposal-currency.ts`, run it only with the flag on):
 *
 *  (a) No reader may depend on capitals. "now one for test employee two",
 *      typed in lower case, read nobody, so the open form was redrafted.
 *  (b) A person after "never", "do not make one", "not" … is the person the
 *      manager said NOT to make one for; "never one for Rowan Pell" made a new
 *      card for Rowan Pell. In "not for X, for Y", only Y counts.
 *
 * Every sentence QA typed, in lower case, in Sentence case and as QA wrote it.
 */
describe("QA-6: the person after 'for' in any case, and never a person the manager ruled out", () => {
  const OPEN = "Test Employee";
  const cases = (sentence: string) => [sentence.toLowerCase(), sentence[0]!.toUpperCase() + sentence.slice(1).toLowerCase(), sentence];

  it.each(cases("now one for Test Employee Two"))('(a) "%s" is another employee', (sentence) => {
    expect(typedPeopleAfterFor(sentence).map((person) => person.toLowerCase())).toEqual(["test employee two"]);
    expect(namesAnotherEmployee(sentence, OPEN)).toBe(true);
  });

  it.each(cases("now one for Test Employee Two at Kearney for being late on 10-20-26"))(
    '(a) "%s" reads Test Employee Two, not "Test" and not Kearney',
    (sentence) => {
      expect(typedPeopleAfterFor(sentence).map((person) => person.toLowerCase())).toEqual(["test employee two"]);
      expect(namesAnotherEmployee(sentence, OPEN)).toBe(true);
    },
  );

  it.each([...cases("never one for Rowan Pell"), ...cases("do not make one for Rowan Pell")])(
    '(b) "%s" is not a new form for Rowan Pell',
    (sentence) => {
      expect(typedPeopleAfterFor(sentence)).toEqual([]);
      expect(namesAnotherEmployee(sentence, OPEN)).toBe(false);
    },
  );

  it.each(cases("one for Test Employee, not Rowan Pell"))('(b) "%s" is still the open form\'s employee', (sentence) => {
    expect(namesAnotherEmployee(sentence, OPEN)).toBe(false);
  });

  it.each(cases("not for Test Employee Two, for Test Employee"))('(b) "%s": only the person after the second "for" counts', (sentence) => {
    expect(typedPeopleAfterFor(sentence).map((person) => person.toLowerCase())).toEqual(["test employee"]);
    expect(namesAnotherEmployee(sentence, OPEN)).toBe(false);
  });

  it.each(cases("not for Test Employee, for Test Employee Two"))('(b) "%s": the person after the second "for" is another employee', (sentence) => {
    expect(typedPeopleAfterFor(sentence).map((person) => person.toLowerCase())).toEqual(["test employee two"]);
    expect(namesAnotherEmployee(sentence, OPEN)).toBe(true);
  });

  it.each([
    "don't make one for Rowan Pell",
    "don’t create one for rowan pell",
    "not one for rowan pell",
    "no CA for Rowan Pell",
    "the same for everyone without Rowan Pell",
    "one for everyone except for rowan pell",
  ])('(b) "%s": every way of ruling a person out', (sentence) => {
    expect(namesAnotherEmployee(sentence, OPEN)).toBe(false);
  });

  it.each([
    ...cases("now one for the closing shift"),
    "now one for being late on 10-20-26",
    "now one for missing the meeting",
    "she was written up for rudeness",
  ])('(a) "%s" names nobody: no name is made from ordinary words', (sentence) => {
    expect(typedPeopleAfterFor(sentence)).toEqual([]);
    expect(namesAnotherEmployee(sentence, OPEN)).toBe(false);
  });

  it("(a) a lower-case name the conversation already knows is read wherever 'for' gives it", () => {
    expect(namesAnotherEmployee("write it up for rowan pell too", OPEN)).toBe(false);
    expect(namesAnotherEmployee("write it up for rowan pell too", OPEN, ["Rowan Pell"])).toBe(true);
    expect(namesAnotherEmployee("write it up for test employee too", OPEN, ["Rowan Pell"])).toBe(false);
  });

  it("names the form only where 'one' is asked for, never where it is ruled out", () => {
    expect(namingTheForm("now one for test employee two", "Corrective Action Form")).toBe("a Corrective Action Form for test employee two");
    expect(namingTheForm("never one for Rowan Pell", "Corrective Action Form")).toBe("never one for Rowan Pell");
    expect(namingTheForm("do not make one for rowan pell", "Corrective Action Form")).toBe("do not make one for rowan pell");
  });
});

describe("QA-6: a name the conversation knows is read whole, never from its first word alone", () => {
  it('"late for test prep" is not another employee because the open form is for Test Employee', () => {
    expect(namesAnotherEmployee("she was late for test prep", "Test Employee")).toBe(false);
  });
});

/*
 * QA-6 re-probe, 26 Oct 2026: an incident after "for" is not a person. With
 * the flag on, "one for rudeness" and "a CA for cash handling" opened a NEW
 * card for "rudeness" / "cash handling" instead of redrafting the open form.
 * QA's exact wordings, in lower case, Sentence case and ALL CAPS.
 */
describe("QA-6 re-probe: an incident or topic after 'for' is never another employee", () => {
  const OPEN = "Test Employee";
  const threeWays = (sentence: string) => [
    sentence.toLowerCase(),
    sentence[0]!.toUpperCase() + sentence.slice(1).toLowerCase(),
    sentence.toUpperCase(),
  ];

  it.each([
    ...threeWays("one for rudeness"),
    ...threeWays("a CA for rudeness"),
    ...threeWays("a CA for cash handling"),
    ...threeWays("another CA for insubordination"),
  ])('"%s" is about the open form, not a person called that', (sentence) => {
    expect(typedPeopleAfterFor(sentence, [OPEN])).toEqual([]);
    expect(namesAnotherEmployee(sentence, OPEN)).toBe(false);
  });

  it.each([
    "now one for theft",
    "another one for attendance",
    "now one for tardiness",
    "another one for lateness",
    "now one for dress code",
    "another one for phone use",
    "now one for no call no show",
    "another one for Rudeness",
  ])('"%s": every incident word, after any lead', (sentence) => {
    expect(namesAnotherEmployee(sentence, OPEN)).toBe(false);
  });

  it.each([
    ...threeWays("now one for Rowan Pell"),
    ...threeWays("another one for Rowan Pell"),
    ...threeWays("now one for Test Employee Two"),
  ])('"%s" is still another employee', (sentence) => {
    expect(namesAnotherEmployee(sentence, OPEN)).toBe(true);
  });

  it("a bare lower-case 'one for <words>' counts only for a known name or a test employee", () => {
    expect(namesAnotherEmployee("one for rowan pell", OPEN)).toBe(false);
    expect(namesAnotherEmployee("one for rowan pell", OPEN, ["Rowan Pell"])).toBe(true);
    expect(namesAnotherEmployee("one for test employee two", OPEN)).toBe(true);
  });
});

describe("QA-6 re-probe: a capitalised first name that is also a common word is still a person", () => {
  it('"now one for Will Testerly" is another employee', () => {
    expect(namesAnotherEmployee("now one for Will Testerly", "Test Employee")).toBe(true);
  });
});
