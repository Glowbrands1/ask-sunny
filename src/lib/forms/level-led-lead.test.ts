import { afterEach, describe, expect, it } from "vitest";

import { withoutLevelLedRequestLead } from "./level-led-lead";
import { withoutRequestInObservation } from "./request-observation";

/*
 * QA's live test in the sibling app, 14 Nov 2026 (its LEVEL_LEADS_REQUEST rollback): "second verbal for <A>, she was
 * late on 11/12/26" got the right level, but the request line stayed in the card's account and the saved Observation.
 * The three live wordings, the person invented.
 */
const LIVE = [
  "second verbal for Quilla Farrowmere, she was late on 11/12/26",
  "another verbal for Quilla Farrowmere, she was late on 11/12/26",
  "2nd written for Quilla Farrowmere, she was late on 11/12/26",
];

afterEach(() => {
  delete process.env.LEVEL_LEADS_REQUEST_ENABLED;
  delete process.env.CA_REASON_DUE_TO_ENABLED;
});

describe("the level-led request lead (LEVEL_LEADS_REQUEST_ENABLED)", () => {
  for (const said of LIVE) {
    it(`flag off: "${said}" keeps its lead`, () => {
      expect(withoutLevelLedRequestLead(said)).toBe(said);
    });

    it(`flag on: "${said}" is its account`, () => {
      process.env.LEVEL_LEADS_REQUEST_ENABLED = "true";
      expect(withoutLevelLedRequestLead(said)).toBe("she was late on 11/12/26");
    });

    it(`flag on: a saved Observation that copies "${said}" keeps only the account`, () => {
      process.env.LEVEL_LEADS_REQUEST_ENABLED = "true";
      process.env.CA_REASON_DUE_TO_ENABLED = "true";
      const fixed = withoutRequestInObservation({ observation: `Observed:\n${said}` }, "observation", "Quilla Farrowmere");
      expect(fixed?.observation).toBe("Observed:\nShe was late on 11/12/26.");
    });
  }

  for (const history of ["written warning for the same thing, now late today", "verbal for that, late again today"]) {
    it(`a level pointing back is not a request: "${history}" is unchanged`, () => {
      process.env.LEVEL_LEADS_REQUEST_ENABLED = "true";
      expect(withoutLevelLedRequestLead(history)).toBe(history);
    });
  }
});
