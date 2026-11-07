import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JOIN } from "./bounded-context";
import { currentFormRequestText, currentFormRequestTurns, startsFormRequest, startsNewRequest } from "./current-request";

const FIRST = "create a corrective action for Remy Calder, he was late opening the salon on 11/2";

describe("currentFormRequestTurns (SECOND_REQUEST_OWN_ACCOUNT_ENABLED; QA's audit, 7 Nov 2026)", () => {
  // Changed on purpose (QA's Sunny round-3 gate, 7 Nov 2026): the request start is now read as the Observation reads it
  // (`ai/remap-incident.ts` currentRequestStart), whose "another / separate <form>" reading is behind this flag; every
  // caller already runs only with it on.
  beforeEach(() => vi.stubEnv("SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

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

  /*
   * QA's Sunny round-3 gate (7 Nov 2026): with the flag on, ordinary single-request cards lost their Policy line —
   * the request was cut at the last turn naming a form. One request is the whole text, wherever its account is.
   */
  describe("one request is the whole text (the round-3 gate)", () => {
    it("the account before the request", () => {
      const turns = ["she was rude to a guest at the front desk on 11/2 and raised her voice at her", "make a CA for Remy Calder"];
      expect(currentFormRequestTurns(turns)).toEqual(turns);
    });

    it("a closing \"create corrective action\" after the account (the SX5 chat)", () => {
      const turns = [
        "do verbal for team member rory vance at kearney. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 rory was not scheduled to work and came into the salon to show her team her new puppy. rory was in the salon 45 min",
        "jba manual 11-1-25",
        "cite pets in workplace",
        "cite animals in the workplace policy",
        "salon location is kearney. create corrective action",
      ];
      expect(currentFormRequestTurns(turns)).toEqual(turns);
    });

    it("a window's state line naming the form, and \"ok create the CA now\"", () => {
      const text = ["The form is the Corrective Action Form.", FIRST, "ok create the CA now"].join(JOIN);
      expect(currentFormRequestText(text)).toBe(text);
    });

    it("startsNewRequest: only a later request with its own incident", () => {
      expect(startsNewRequest([], FIRST)).toBe(false);
      expect(startsNewRequest(["she was rude to a guest on 11/2"], "make a CA for Remy Calder")).toBe(false);
      expect(startsNewRequest([FIRST, "no payroll deduct"], "create a corrective action for Remy Calder, his cash drawer was short $20 on 11/3")).toBe(true);
    });
  });
});
