import { describe, expect, it } from "vitest";

import { observationDateMismatch, withoutMisdatedRestatements } from "./observation-dates";

/*
 * QA's Bubbles live re-run (22 Nov 2026, A3), the manager's words (the person invented): "create corrective action for
 * <P> for violating standards of conduct policy on 10-20-26. <P> failed to acknowledge policies in woven by the
 * 10-15-26 deadline." The card said "by the 10/15/26 deadline"; the reply said "by the 10/20/26 deadline".
 */
const OBSERVATION = "Ozren Brack failed to acknowledge policies in Woven by the 10/15/26 deadline.";

describe("observationDateMismatch (A3)", () => {
  it("a reply restating the account with the form's date in place of the deadline is a mismatch", () => {
    expect(observationDateMismatch("Ozren failed to acknowledge policies in Woven by the 10/20/26 deadline.", OBSERVATION)).toEqual(["observation date (10/20/26)"]);
  });

  it("the account's own date, in any style, is no mismatch", () => {
    expect(observationDateMismatch("Ozren failed to acknowledge policies in Woven by the 10/15/26 deadline.", OBSERVATION)).toEqual([]);
    expect(observationDateMismatch("Ozren failed to acknowledge policies in Woven by the October 15, 2026 deadline.", OBSERVATION)).toEqual([]);
  });

  it("the form's date beside the account's own date is no mismatch", () => {
    expect(observationDateMismatch("On 10/20/26: Ozren failed to acknowledge policies in Woven by the 10/15/26 deadline.", OBSERVATION)).toEqual([]);
  });

  it("a sentence that does not restate the account may carry any date", () => {
    expect(observationDateMismatch("The form is dated 10/20/26.", OBSERVATION)).toEqual([]);
    expect(observationDateMismatch("Ozren failed to acknowledge policies in Woven by the 10/20/26 deadline.", null)).toEqual([]);
  });

  it("only the misdated restatement is left out; the rest of the reply stays", () => {
    const reply = "Here's the Corrective Action Form for **Ozren**.\n\nOzren failed to acknowledge policies in Woven by the 10/20/26 deadline.\n\n**Policy:** Standards of Conduct";
    expect(withoutMisdatedRestatements(reply, OBSERVATION)).toBe("Here's the Corrective Action Form for **Ozren**.\n\n**Policy:** Standards of Conduct");
  });
});
