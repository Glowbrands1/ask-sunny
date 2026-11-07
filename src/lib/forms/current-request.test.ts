import { describe, expect, it } from "vitest";

import { JOIN } from "./bounded-context";
import { currentFormRequestText, currentFormRequestTurns, startsFormRequest } from "./current-request";

const FIRST = "create a corrective action for Remy Calder, he was late opening the salon on 11/2";

describe("currentFormRequestTurns (SECOND_REQUEST_OWN_ACCOUNT_ENABLED; QA's audit, 7 Nov 2026)", () => {
  it("a second request starts the request now being written, in each wording", () => {
    for (const second of [
      "I need another corrective action for Remy Calder, his cash drawer was short $20 on 11/3",
      "now make a separate CA for Remy Calder for his cash drawer being short $20 on 11/3",
      "create a corrective action for Remy Calder, his cash drawer was short $20 on 11/3",
    ]) {
      expect(startsFormRequest(second), second).toBe(true);
      expect(currentFormRequestTurns([FIRST, "no payroll deduct", second, "it was a verbal"])).toEqual([second, "it was a verbal"]);
    }
  });

  it("follow-ups ask for no form and stay with their request", () => {
    expect(currentFormRequestTurns([FIRST, "no payroll deduct", "it was a verbal"])).toEqual([FIRST, "no payroll deduct", "it was a verbal"]);
  });

  it("no turn asks for a form: every turn", () => {
    expect(currentFormRequestTurns(["he was late", "no payroll deduct"])).toEqual(["he was late", "no payroll deduct"]);
  });

  it("over a window's joined text", () => {
    const second = "I need another corrective action for Remy Calder, his cash drawer was short $20 on 11/3";
    expect(currentFormRequestText([FIRST, second].join(JOIN))).toBe(second);
  });
});
