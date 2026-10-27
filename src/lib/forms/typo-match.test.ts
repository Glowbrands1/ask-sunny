import { describe, expect, it } from "vitest";

import { correctedText, editDistance, onlyMatch } from "./typo-match";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "yesterday", "today"];

describe("editDistance", () => {
  it("counts a dropped, added, changed or swapped letter as one", () => {
    expect(editDistance("tusday", "tuesday")).toBe(1);
    expect(editDistance("tuesdy", "tuesday")).toBe(1);
    expect(editDistance("thrusday", "thursday")).toBe(1);
    expect(editDistance("yesturday", "yesterday")).toBe(1);
  });
});

describe("onlyMatch", () => {
  it("reads the one word a typo can only be", () => {
    expect(onlyMatch("yesturday", DAYS)).toBe("yesterday");
    expect(onlyMatch("tuesdy", DAYS)).toBe("tuesday");
    expect(onlyMatch("Tusday", DAYS)).toBe("tuesday");
    expect(onlyMatch("wenesday", DAYS)).toBe("wednesday");
  });

  it("never guesses a tie", () => {
    expect(onlyMatch("caste", ["caste", "cast"])).toBeNull();
    expect(onlyMatch("mander", ["manger", "mender"])).toBeNull();
  });

  it("leaves short words, numbers, list words and protected words alone", () => {
    expect(onlyMatch("tues", DAYS)).toBeNull();
    expect(onlyMatch("10/20", DAYS)).toBeNull();
    expect(onlyMatch("monday", DAYS)).toBeNull();
    expect(onlyMatch("munday", DAYS, (word) => word === "munday")).toBeNull();
  });

  it("an ending is a word, not a slip", () => {
    expect(onlyMatch("noticed", ["notice"])).toBeNull();
    expect(onlyMatch("mondays", DAYS)).toBeNull();
    expect(onlyMatch("coach", ["coached"])).toBeNull();
  });

  it("needs the same first letter", () => {
    expect(onlyMatch("ruesday", DAYS)).toBeNull();
  });

  it("a name that is near a day word is protected by the caller", () => {
    // "Monda" (an invented first name) is one letter from "monday".
    expect(onlyMatch("Monda", DAYS)).toBe("monday");
    expect(onlyMatch("Monda", DAYS, (word) => word === "monda")).toBeNull();
  });
});

describe("correctedText", () => {
  it("maps every corrected position back to what was typed", () => {
    const typed = "she was late last tusday, really";
    const copy = correctedText(typed, DAYS);
    expect(copy.text).toBe("she was late last tuesday, really");
    const at = copy.text.indexOf("last tuesday");
    const end = at + "last tuesday".length;
    expect(typed.slice(copy.original(at), copy.original(end - 1) + 1)).toBe("last tusday");
  });
});
