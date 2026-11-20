import { describe, expect, it } from "vitest";

import { wholeNameWords } from "./tools";

/** QA's code audit, item 27: a typed name matches whole words of a form's employee name, never part of a word. */
describe("wholeNameWords (item 27)", () => {
  it("matches the full name, the first name or the last name, as whole words", () => {
    expect(wholeNameWords("Ann Lee", "Ann Lee")).toBe(true);
    expect(wholeNameWords("Ann Lee", "ann")).toBe(true);
    expect(wholeNameWords("Ann Lee", "LEE")).toBe(true);
  });

  it("never matches part of a word, or another person's longer name", () => {
    expect(wholeNameWords("Hannah Brook", "Ann")).toBe(false);
    expect(wholeNameWords("Joann Lee", "Ann")).toBe(false);
    expect(wholeNameWords("Joann Lee", "Ann Lee")).toBe(false);
    expect(wholeNameWords("Ann Leeds", "Ann Lee")).toBe(false);
    expect(wholeNameWords("Ann Lee", "")).toBe(false);
  });
});
