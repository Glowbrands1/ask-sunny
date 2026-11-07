import { afterEach, describe, expect, it, vi } from "vitest";

import { detectTemplateIntent } from "./template-intent";

/* Pau's scan, sf-s35 (7 Nov 2026): the live wording, the employee invented. */
const SAID =
  "Can you draw me up a CA for Wrenna Calloway for being late on 10/23/26. Wrenna has signed a coaching document for being late on 10/14/26. I need you to make sure the policy is on this CA.";

afterEach(() => vi.unstubAllEnvs());

describe("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED", () => {
  it("off: the earlier coaching is read as the form asked for (the live card)", () => {
    expect(detectTemplateIntent(SAID)).toEqual({ kind: "explicit", templateKey: "coaching" });
  });

  it("on: it is the Corrective Action request", () => {
    vi.stubEnv("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED", "true");
    expect(detectTemplateIntent(SAID).kind).toBe("corrective_action");
  });

  it("on: a switch, a coaching request and a message that names a coaching first are unchanged", () => {
    vi.stubEnv("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED", "true");
    for (const text of [
      "create a coaching form for Wrenna Calloway for being late",
      "Coaching form for Wrenna Calloway. Also a CA for Remy Calder.",
      "CA for Wrenna Calloway, actually make it a coaching form",
    ]) {
      vi.stubEnv("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED", "");
      const off = detectTemplateIntent(text);
      vi.stubEnv("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED", "true");
      expect(detectTemplateIntent(text), text).toEqual(off);
    }
  });
});
