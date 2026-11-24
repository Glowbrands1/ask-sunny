import { describe, expect, it } from "vitest";

import { asManagerCommaWrote, lastCommaFirst } from "./tools";

/* QA's re-run (22 Nov 2026, C3; found in Ask Bubbles): "create a CA form for <Last>, <First> at <salon>. she was late on 10-16". */
describe("lastCommaFirst (C3)", () => {
  it("two single words around one comma read as Last, First", () => {
    expect(lastCommaFirst("larkspur, vesna")).toBe("vesna larkspur");
    expect(lastCommaFirst("Larkspur,Vesna")).toBe("Vesna Larkspur");
    expect(lastCommaFirst("O'Dell, Mary-Kate")).toBe("Mary-Kate O'Dell");
  });

  it("any other shape is kept as typed", () => {
    expect(lastCommaFirst("Vesna Larkspur")).toBe("Vesna Larkspur");
    expect(lastCommaFirst("Larkspur, Vesna Jo")).toBe("Larkspur, Vesna Jo");
    expect(lastCommaFirst("Vesna, the shift lead")).toBe("Vesna, the shift lead");
  });
});

/* Port of Ask Bubbles #1054 (its QA's live round 3, 22 Nov 2026, C3): the model passed "<First> <Last>" for the manager's "<Last>, <First>"; the person is invented. */
describe("asManagerCommaWrote (C3, round 3)", () => {
  const said = "create a CA form for Pellwood, Vashti at kearney. she was late on 10-16";
  it("a first-last name the manager wrote only as Last, First is read in the manager's order", () => {
    expect(asManagerCommaWrote("Vashti Pellwood", said)).toBe("Pellwood, Vashti");
    expect(asManagerCommaWrote("vashti pellwood", said)).toBe("Pellwood, Vashti");
  });

  it("a name the manager wrote as passed, or never wrote with a comma, is kept", () => {
    expect(asManagerCommaWrote("Vashti Pellwood", "create a CA form for Vashti Pellwood, she was late")).toBe("Vashti Pellwood");
    expect(asManagerCommaWrote("Vashti Pellwood", "create a CA form for Vashti at kearney")).toBe("Vashti Pellwood");
    expect(asManagerCommaWrote("Pellwood, Vashti", said)).toBe("Pellwood, Vashti");
    expect(asManagerCommaWrote("Vashti", said)).toBe("Vashti");
    expect(asManagerCommaWrote("Ashti Pellwood", said)).toBe("Ashti Pellwood");
  });
});
