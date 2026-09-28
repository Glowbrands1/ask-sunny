import { describe, expect, it } from "vitest";

import { readSalonMentions } from "./salon-mention";

/**
 * The salon a manager names is used to fill in a form's location, so a false
 * reading is worse than a missed one: a miss leaves the account's own answer or
 * a question, a false hit can ask about — or, inside a manager's assignment,
 * fill in — a salon nobody mentioned.
 */
function named(text: string): string[] {
  return readSalonMentions(text).flatMap((mention) => mention.salonIds);
}

describe("a salon the manager names", () => {
  it.each([
    ["late at Wornall today", ["loc-0306"]],
    ["she was late at KC Wornall", ["loc-0306"]],
    ["at MO Kansas City Wornall", ["loc-0306"]],
    ["she works at the Lawrence salon", ["loc-0468"]],
    ["dana moss, KS Shawnee, today", ["loc-0463"]],
    ["NE Kearney", ["loc-0309"]],
    ["salon 306", ["loc-0306"]],
    ["store #0306", ["loc-0306"]],
    ["she was in Liberty today", ["loc-0394"]],
    ["late at Lincoln O. Street this morning", ["loc-0311"]],
    ["late at Omaha 144th & Center", ["loc-0314"]],
  ])("reads %s", (text, ids) => {
    expect(named(text)).toEqual(ids);
  });

  it("reads a shared city as every salon in it", () => {
    expect(named("she was late at Lincoln today").sort()).toEqual(["loc-0310", "loc-0311", "loc-0312"]);
  });
});

describe("an employee's name is not a salon", () => {
  it.each([
    "Create a coaching form for Lawrence Smith",
    "coaching form for Liberty Jones",
    "corrective action for Kearney Adams",
    "coaching form for Manhattan Brown",
    "Write one for Grace Pacific",
    "coaching form for Joseph St Clair",
  ])("%s", (text) => {
    expect(named(text)).toEqual([]);
  });
});

describe("ordinary prose is not a salon", () => {
  it.each([
    "she's not at liberty to discuss it",
    "he said he was at liberty to leave early",
    "in Pacific time she was late",
    "she clocked in at 9 Pacific time",
    "she used to work at Kearney High",
    "she moved from Lawrence last year",
    "she parked on 27th Street",
    "the o street entrance was locked",
    "she took the pine lake exit",
    "she lives in Lincoln Park",
    "she works at Lincoln South",
    "she went to Omaha Steaks for lunch",
    "we talked in St Joseph's hospital",
    "she was late at lunch again",
    "store 12",
    "location 3 of the checklist",
    "she did 144 upgrades",
  ])("%s", (text) => {
    expect(named(text)).toEqual([]);
  });
});
