import { afterEach, describe, expect, it } from "vitest";

import { startsFormForAnotherPerson } from "./new-person-request";

/**
 * NEW_PERSON_OWN_WORDS_ENABLED (Pau via QA, 5 Nov 2026, sf-s22; the manager's
 * turns verbatim, people invented): "It needs to be a CA, not a coaching
 * form", read behind the stored state, started a "new form" for Wynne and the
 * card lost the account given on turn 1.
 */
const HISTORY = [
  { role: "user", content: "create a ca for must see behaviors for performace  this should be for wynne sarrow  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%  but i need it to be in the format of Tamsyn ca" },
  { role: "assistant", content: "I'll draft a **Corrective Action Form** for **Wynne Sarrow** …" },
  { role: "user", content: "Use this to make it: For the month of October 2026, Corwen Pell completed 24 tans and was below expectations." },
];
const WITH_STATE = "The form is the Corrective Action Form.\nThe employee is Wynne Sarrow. Job title: Tanning Consultant.\nIt needs to be a CA, not a coaching form";

afterEach(() => {
  delete process.env.NEW_PERSON_REQUEST_ENABLED;
  delete process.env.NEW_PERSON_OWN_WORDS_ENABLED;
});

describe("the stored state is not a new request for another person", () => {
  it("off, the state lines read as a new form for Wynne (the reported card)", () => {
    process.env.NEW_PERSON_REQUEST_ENABLED = "true";
    expect(startsFormForAnotherPerson(HISTORY, WITH_STATE)).toBe(true);
  });

  it("on, the manager's own words start no new form", () => {
    process.env.NEW_PERSON_REQUEST_ENABLED = "true";
    process.env.NEW_PERSON_OWN_WORDS_ENABLED = "true";
    expect(startsFormForAnotherPerson(HISTORY, WITH_STATE)).toBe(false);
  });

  it("on, a real request for another person still does", () => {
    process.env.NEW_PERSON_REQUEST_ENABLED = "true";
    process.env.NEW_PERSON_OWN_WORDS_ENABLED = "true";
    const history = [{ role: "user", content: "create a corrective action for Tamsyn Fairlow, she was late on 10/20" }];
    expect(startsFormForAnotherPerson(history, "The employee is Tamsyn Fairlow.\nnow create a coaching form for Corwen Pell, he was late on 10/21")).toBe(true);
  });
});
