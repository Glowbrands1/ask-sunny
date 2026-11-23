import { describe, expect, it } from "vitest";

import { lastCommaFirst } from "./tools";

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
