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
    ["salon 0306", ["loc-0306"]],
    ["store #0306", ["loc-0306"]],
    // A Google store code where no salon number reads the same digits.
    ["store 373", ["loc-0476"]],
    ["she works at 0307", ["loc-0307"]],
    ["she was in Liberty today", ["loc-0394"]],
    ["late at Lincoln O. Street this morning", ["loc-0311"]],
    ["late at Omaha 144th & Center", ["loc-0314"]],
    // Name, role, salon — production QA, 20 October 2026.
    ["Brandi Algya ASD Lincoln O St. Properly uploading documentation", ["loc-0311"]],
    ["Brandi Algya SD Pine Lake", ["loc-0312"]],
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
    // A one-word salon name after a role can still be the person's name.
    "my SD Lawrence was late",
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
    /*
     * A three-digit number that is one salon's number and ANOTHER salon's
     * Google store code names neither: 306 is Wornall (0306) or KS Manhattan
     * (store 306), and guessing files the record at the wrong one.
     */
    "salon 306",
    "store 307",
    "#314",
    // A clock time is not a salon.
    "she was late at 310",
  ])("%s", (text) => {
    expect(named(text)).toEqual([]);
  });
});

/*
 * QA F-05, 22 Oct 2026: a bare number after "at" filed a salon nobody named.
 * Times, prices, quantities and dates are never salons; a location word or the
 * zero-padded salon number is what makes a number a salon.
 */
describe("a number is a salon only when something says so", () => {
  it.each([
    // Times.
    "she got here at 410 today",
    "she stayed at 410 for an hour",
    "she clocked in at 4:10",
    "she showed up at 410pm",
    "she came in at 410 p.m.",
    "we met at 409 for lunch",
    // Prices and quantities.
    "she sold a package at 140",
    "rang up a sale at 231 dollars",
    "she sold it at $231",
    "she was 140 minutes late",
    "for 410 minutes",
    // Dates.
    "she was late on 10/15",
    "she was late at 10/15 opening",
    // A bare Google store code after "at": a price as often as a salon.
    "she was at 373 yesterday",
  ])("%s", (text) => {
    expect(named(text)).toEqual([]);
  });

  it.each([
    ["she works at salon 0410", ["loc-0410"]],
    ["salon 410", ["loc-0410"]],
    ["store #0410", ["loc-0410"]],
    ["#0410", ["loc-0410"]],
    ["location 0306", ["loc-0306"]],
    ["she works at 0307", ["loc-0307"]],
    ["she was late at store 373", ["loc-0476"]],
  ])("reads %s", (text, ids) => {
    expect(named(text)).toEqual(ids);
  });

  it("keeps the 306/307/314 rule: a number that names two salons names neither", () => {
    expect(named("store 306")).toEqual([]);
    expect(named("salon 314")).toEqual([]);
  });
});

describe("a salon set off by punctuation", () => {
  it.each([
    ["Avery Testperson, lincoln 27th st", ["loc-0310"]],
    ["Avery Testperson (Overland Park)", ["loc-0476"]],
    ["she works at kearney, needs a coaching form", ["loc-0309"]],
    ["coaching form: Brandi Algya, ASD, Lincoln O St", ["loc-0311"]],
  ])("reads %s", (text, ids) => {
    expect(named(text)).toEqual(ids);
  });

  it.each([
    // The salon's road on its own is still a road.
    "she parked on main, 27th st",
    "she took the exit, pine lake",
  ])("%s", (text) => {
    expect(named(text)).toEqual([]);
  });
});
