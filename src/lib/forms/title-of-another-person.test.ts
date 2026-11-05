import { describe, expect, it } from "vitest";

import { titleNamesAnotherPerson } from "./title-of-another-person";

/** QA, 5 Nov 2026, R2 (the sibling app's report), in this app's words; every person invented. */
const R2 =
  "verbal warning The date she complained was Oct 31st . The guest said she was giving her an attitude when she brought up that the register was charging her for a lotion she did not buy and it has never done that before. When Odalys spoke with District manager Thessaly Brookhart on the phone about how to fix this, Odalys told the guest that she was making her job really hard. The guest reached out to district manager Thessaly Brookhart saying Odalys was very rude to her and Odalys told her she knows how to do her job she has worked here for two years. no payroll deduct.";

describe("TITLE_OF_THE_EMPLOYEE_ENABLED: a title attached to another named person is theirs", () => {
  it("R2: \"District manager Thessaly Brookhart\" (twice) is not Odalys Prewett Vansickle's title", () => {
    expect(titleNamesAnotherPerson(R2, "District Manager", "Odalys Prewett Vansickle")).toBe(true);
  });

  it("the employee's own title stays theirs: beside their name, or beside no name", () => {
    expect(titleNamesAnotherPerson("Salon Director Odalys Prewett was late opening", "Salon Director", "Odalys Prewett")).toBe(false);
    expect(titleNamesAnotherPerson("she is an assistant salon director and was late", "Assistant Salon Director", "Odalys Prewett")).toBe(false);
  });

  it("once beside another person and once on its own: not settled, left as before", () => {
    expect(titleNamesAnotherPerson("Odalys is a district manager. She called District manager Thessaly Brookhart.", "District Manager", "Odalys Prewett")).toBe(false);
  });

  it("a title not written out, or no employee: left as before", () => {
    expect(titleNamesAnotherPerson(R2, "Salon Director", "Odalys Prewett Vansickle")).toBe(false);
    expect(titleNamesAnotherPerson(R2, "District Manager", null)).toBe(false);
  });
});
