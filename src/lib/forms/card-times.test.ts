import { describe, expect, it } from "vitest";

import { clockTimes, withCardTimes } from "./card-times";

const CARD = "On 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.";

describe("the card's times reach the saved account (c198)", () => {
  it("reads each clock time once, whatever its spelling", () => {
    expect(clockTimes(CARD)).toEqual(["9:15", "9:01", "8:11"]);
    expect(clockTimes("at 9:15 p.m., then 8 PM, then 7;30am")).toEqual(["9:15", "8:00", "7:30"]);
    expect(clockTimes("10-15 minutes late on 11/3, 146 tans")).toEqual([]);
  });

  it("brings back the card's sentence for each lost time", () => {
    const drafted = "The employee took down the spray booths at 8:11 p.m., before the salon closed.";
    expect(withCardTimes(drafted, CARD)).toBe(`${drafted} On 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01.`);
  });

  it("changes nothing when every time is kept, or there is no card account", () => {
    const drafted = "Scheduled until 9:15 PM; clocked out at 9:01 PM. Took the booths down at 8:11 PM.";
    expect(withCardTimes(drafted, CARD)).toBe(drafted);
    expect(withCardTimes(drafted, null)).toBe(drafted);
    expect(withCardTimes("", CARD)).toBe("");
  });
});
