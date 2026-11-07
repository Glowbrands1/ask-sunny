import { describe, expect, it } from "vitest";

import { ACTIVE_BRAND } from "@/lib/brand";

import { namesThisCompany } from "./company-name";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word[0]!))
    .join("");

describe("namesThisCompany (QA, 7 Nov 2026)", () => {
  it("the brand config's brand and operator names, and their initials, in any case", () => {
    for (const name of [ACTIVE_BRAND.brandName, ACTIVE_BRAND.operatorName]) {
      expect(namesThisCompany(name)).toBe(true);
      expect(namesThisCompany(name.toLowerCase())).toBe(true);
      expect(namesThisCompany(` ${initials(name)} `)).toBe(true);
    }
  });

  it("a person, a part of the name, or one letter is not the company", () => {
    expect(namesThisCompany("Dorran Ashby")).toBe(false);
    expect(namesThisCompany(ACTIVE_BRAND.brandName.split(/\s+/)[0]!)).toBe(false);
    expect(namesThisCompany(initials(ACTIVE_BRAND.brandName)[0]!)).toBe(false);
    expect(namesThisCompany("")).toBe(false);
  });
});
