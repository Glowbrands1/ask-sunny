import { describe, expect, it } from "vitest";

import { typedFullNameOf } from "./tools";

/* R14 (QA's Bubbles round 2, 22 Nov 2026): the one full name the manager typed that starts with the model's one-word name. */
describe("typedFullNameOf", () => {
  const T1 = "create a written corrective action for Team Member, Test Employee. Test was assigned to complete policy acknowledgements in woven by 10-15-26 and failed to meet the deadline.";

  it("reads the full name the manager typed, never the first word's own sentence (\"Test was assigned\")", () => {
    expect(typedFullNameOf("Test", T1)).toBe("Test Employee");
    expect(typedFullNameOf("test", "name is Test Employee")).toBe("Test Employee");
  });

  it("gives nothing for two different full names, a lowercase phrase, or a name of two words", () => {
    expect(typedFullNameOf("Test", "Test Employee and Test Person")).toBeNull();
    expect(typedFullNameOf("test", "test was late")).toBeNull();
    expect(typedFullNameOf("Test Employee", T1)).toBeNull();
  });
});
