import { describe, expect, it } from "vitest";

import { readStatedAddress, statedAddressValue } from "./stated-address";

describe("readStatedAddress", () => {
  it.each([
    ["her address is 1234 Elm St, Lawrence, KS 66044", "1234 Elm St, Lawrence, KS 66044"],
    ["Address: 55 W. 9th St. Apt 4, Lawrence KS 66044. She quit by text.", "55 W. 9th St. Apt 4, Lawrence KS 66044"],
    ["permanent address 900 Oak Ave Topeka KS", "900 Oak Ave Topeka KS"],
    ["she lives at 12 Pine Rd, Olathe, KS 66061 and she returned her key", "12 Pine Rd, Olathe, KS 66061"],
    ["mailing address - PO Box 44, Lincoln NE 68501", "PO Box 44, Lincoln NE 68501"],
    ["her address is 1234 Elm St and she returned her key", "1234 Elm St"],
  ])("%s", (text, expected) => {
    expect(readStatedAddress(text)).toBe(expected);
  });

  it.each([
    "she works at 1200 Main St",
    "what is her address?",
    "address is on file",
    "I'll get her address later",
    "she quit on 9/25",
  ])("reads nothing from %s", (text) => {
    expect(readStatedAddress(text)).toBeNull();
  });

  it("takes the last address stated, so a correction wins", () => {
    expect(
      readStatedAddress("address is 1 Elm St, Lawrence KS 66044.\n\nsorry, her address is 2 Oak St, Lawrence KS 66044"),
    ).toBe("2 Oak St, Lawrence KS 66044");
  });
});

describe("statedAddressValue", () => {
  it("accepts a plausible address and nothing else", () => {
    expect(statedAddressValue("  1234  Elm St ")).toBe("1234 Elm St");
    expect(statedAddressValue(42)).toBeNull();
    expect(statedAddressValue("x")).toBeNull();
    expect(statedAddressValue("1".repeat(201))).toBeNull();
  });
});
