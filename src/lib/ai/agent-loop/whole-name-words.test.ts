import { describe, expect, it } from "vitest";

import { nameThenStartOfNext, wholeNameWords } from "./tools";

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

describe("nameThenStartOfNext (Pau's live chat, 20 Nov 2026: \"forms for <P> co\")", () => {
  it("a whole first name, then the start of the last name", () => {
    expect(nameThenStartOfNext("Liesel Cobb", "liesel co")).toBe(true);
    expect(nameThenStartOfNext("Liesel Cobb", "Liesel Co")).toBe(true);
  });
  it("never part of a first name, a one-letter start, or one word", () => {
    expect(nameThenStartOfNext("Joann Lee", "ann le")).toBe(false);
    expect(nameThenStartOfNext("Liesel Cobb", "liesel c")).toBe(false);
    expect(nameThenStartOfNext("Liesel Cobb", "liesel")).toBe(false);
    expect(nameThenStartOfNext("Liesel Cobb", "lies co")).toBe(false);
  });
});
