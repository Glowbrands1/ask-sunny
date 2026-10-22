import { describe, expect, it } from "vitest";

import { extractEmployeeNames } from "./proposal";

/*
 * QA F-03d, 22 Oct 2026: "create verbal ca for pat rivera dated 10/20" named
 * the employee "pat rivera dated". A word that introduces a date ends a typed
 * name; the manager's own spelling is kept. Synthetic people only.
 */
describe("a word that introduces a date ends the employee's name", () => {
  it.each([
    ["create verbal ca for pat rivera dated 10/20. she was late on 10/5 and 10/15", ["pat rivera"]],
    ["COACHING FORM FOR AVERY TESTPERSON DATED 10/2", ["AVERY TESTPERSON"]],
    ["coaching form for jo mcdonald due 10/30", ["jo mcdonald"]],
    ["create a ca for dana moss, it happened 10/12", ["dana moss"]],
    ["coaching form for sam jones, occurred two days ago", ["sam jones"]],
  ])("%s", (text, names) => {
    expect(extractEmployeeNames(text)).toEqual(names);
  });

  it("still reads a full name with a middle name when no date word follows", () => {
    expect(extractEmployeeNames("coaching form for mary anne cruz")).toEqual(["mary anne cruz"]);
  });
});
