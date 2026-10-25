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
