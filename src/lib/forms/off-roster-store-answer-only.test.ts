import { describe, expect, it } from "vitest";

import { storeOnlyAnswer } from "./off-roster-ask";

/* OFF_ROSTER_STORE_ANSWER_ONLY_ENABLED (QA's ruling on Ask Bubbles' #735 gate, 12 Nov 2026): which replies are only a salon. */
describe("storeOnlyAnswer", () => {
  it.each(["kearney, ne", "Kearney, NE", "o st", "at kearney"])("only a salon: %s", (said) => {
    expect(storeOnlyAnswer(said)).toBe(true);
  });

  it.each(["she was late at kearney", "kira dunmore", "use Kira Dunmore", "yes"])("more than a salon, or none: %s", (said) => {
    expect(storeOnlyAnswer(said)).toBe(false);
  });
});
