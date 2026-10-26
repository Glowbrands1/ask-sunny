import { describe, expect, it } from "vitest";

import { accountSentences } from "./remap-incident";

/**
 * Locking test, no behavior change. Ask Bubbles conv_mvofkkrg2ipw28x (25 Oct
 * 2026) cut "$3.25" to "$3" in the card's Issue: its reader ended a sentence
 * at the point. Ask Sunny has no Issue line, and its Observation of Offense
 * ends a sentence only at a point followed by a space, so the amount stays
 * whole here already. The manager's turn is copied exactly, with an invented
 * name. Ask Bubbles fixes its reader behind DECIMAL_KEEP_ENABLED.
 */
describe("Observation of Offense keeps a dollar amount with cents", () => {
  it("keeps $3.25 in the reported turn", () => {
    expect(
      accountSentences(["create ca form for wren calloway, register shortage 10-20-26, $3.25 payroll deduct"], "wren calloway"),
    ).toEqual(["register shortage 10-20-26, $3.25 payroll deduct"]);
  });

  it("keeps $3.25 when the account is its own sentence", () => {
    expect(
      accountSentences(
        [
          "create ca form for wren calloway. wren had a register shortage of $3.25 on 10-20-26. payroll deduct of $3.25 is applicable",
        ],
        "wren calloway",
      ),
    ).toContain("wren had a register shortage of $3.25 on 10-20-26");
  });
});
