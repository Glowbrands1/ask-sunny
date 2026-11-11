import { describe, expect, it } from "vitest";

import { namesOnlyAPolicy } from "./person-guard";

/** OBSERVATION_NOT_POLICY_NAME_ENABLED — QA live check, 3 Nov 2026: "can you create a CA for must see behaviors". */
describe("words that only name a policy", () => {
  for (const words of ["must see behaviors", "the standards of conduct", "Bonus Policy", "must see behaviors on woven"]) {
    it(`${JSON.stringify(words)}: a policy's name, not an account`, () => {
      expect(namesOnlyAPolicy(words)).toBe(true);
    });
  }

  for (const words of [
    "she skipped the must see behaviors during her shift on Tuesday",
    "she was late to opening this morning",
    "failed to take trash out and put rugs out untl 12;30pm",
    "",
  ]) {
    it(`${JSON.stringify(words)}: kept`, () => {
      expect(namesOnlyAPolicy(words)).toBe(false);
    });
  }
});
