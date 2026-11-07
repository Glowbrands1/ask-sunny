import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { accountSentences, isRequestReasonOnly, managerAccount } from "./remap-incident";

/**
 * REQUEST_PARTICIPLE_LEAD_ENABLED (QA's round-5 live Sunny check, 8 Nov 2026, history 1143df48): "I need a corrective
 * action made for under performance. <A> was below on PPTA, …" — the card's Observation began "made for under
 * performance.". The person is invented.
 */
const REQUEST = "I need a corrective action made for under performance.";
const ACCOUNT = "Remy Calder was below on PPTA, LPSVA, Club Average, Club Close % and Spa in the month of October";

describe("REQUEST_PARTICIPLE_LEAD_ENABLED", () => {
  beforeEach(() => vi.stubEnv("CA_SALES_POLICY_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("off (as before): \"made for\" is left in front of the reason", () => {
    expect(managerAccount(REQUEST, null)).toBe("made for under performance.");
  });

  describe("on", () => {
    beforeEach(() => vi.stubEnv("REQUEST_PARTICIPLE_LEAD_ENABLED", "true"));

    it("\"made / done / written up for\" after the form is the request", () => {
      for (const participle of ["made", "done", "written up", "drawn up", "filled out"]) {
        expect(managerAccount(`I need a corrective action ${participle} for under performance.`, null), participle).toBe("under performance.");
      }
      expect(managerAccount("I need a corrective action made for Remy Calder for late opening the salon on 11/2", "Remy Calder")).toBe(
        "late opening the salon on 11/2",
      );
    });

    it("a participle with no \"for\" after it reads as with the flag off", () => {
      const said = "the corrective action made her cry";
      const on = managerAccount(said, null);
      vi.stubEnv("REQUEST_PARTICIPLE_LEAD_ENABLED", "");
      expect(on).toBe(managerAccount(said, null));
    });

    it("the request's sales reason is only the reason; an offense is the account", () => {
      expect(isRequestReasonOnly(REQUEST, "under performance.")).toBe(true);
      expect(isRequestReasonOnly("I need a corrective action made for late opening.", "late opening.")).toBe(false);
      expect(isRequestReasonOnly(ACCOUNT, "under performance")).toBe(false);
    });

    it("the Observation starts at the account; the reason alone stays", () => {
      const sentences = accountSentences([`${REQUEST} ${ACCOUNT}`], null);
      expect(sentences[0]).toMatch(/^Remy Calder was below on PPTA\b/);
      expect(sentences.join(" ")).not.toMatch(/under performance|made for/);
      expect(accountSentences([REQUEST], null)).toEqual(["under performance"]);
    });
  });
});
