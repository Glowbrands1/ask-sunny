import { describe, expect, it } from "vitest";

import { quoteNamesForm } from "./tools";

/** Board f108 (QA handoff, 22 Nov 2026): the form lock is left only by words that name the form switched to. */
const CA = { name: "Corrective Action Form" };
const COACHING = { name: "Coaching Form", shortName: "Coaching" };
const FOLLOW_UP = { name: "Follow-Up Coaching Form" };

describe("quoteNamesForm (f108)", () => {
  it.each([
    ["make it a CA", CA],
    ["make it a corrective action instead", CA],
    ["make it a coaching form instead", COACHING],
    ["just a coaching", COACHING],
    ["do a follow up coaching", FOLLOW_UP],
    ["a FUC for her", FOLLOW_UP],
    ["Want me to make it a Coaching Form instead?", COACHING],
  ] as const)("%s names the form", (text, template) => {
    expect(quoteNamesForm(text, template)).toBe(true);
  });
  it.each([
    ["she said she'd be late again", COACHING],
    ["she said she'd be late again", CA],
    ["the cash count was off", CA],
    ["yes", COACHING],
    ["she was late to open on 11/21", FOLLOW_UP],
  ] as const)("%s does not name the form", (text, template) => {
    expect(quoteNamesForm(text, template)).toBe(false);
  });
});
