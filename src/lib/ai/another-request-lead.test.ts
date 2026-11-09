import { afterEach, describe, expect, it, vi } from "vitest";

import FLAGS from "@/config/production-flags.json";

import { managerAccount } from "./remap-incident";

/**
 * ANOTHER_REQUEST_LEAD_ENABLED (QA, Sunny round 7c and 9 live, 9 Nov 2026; the person invented): "I need another
 * corrective action for <P>, his cash drawer was short $20 on 11/3" was the card's whole Observation. The replay pack
 * covers the route (`nov9-another-request-lead-cases.ts`).
 */
const NAME = "Corwin Ashgrove";
/** Production's flags, as the live card was read. */
const production = () => {
  for (const flag of FLAGS.on) vi.stubEnv(flag, "true");
};
afterEach(() => vi.unstubAllEnvs());

describe("ANOTHER_REQUEST_LEAD_ENABLED", () => {
  it("off: the whole request is the account (the live Observation)", () => {
    production();
    const said = "I need another corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3";
    expect(managerAccount(said, NAME)).toBe(said);
  });

  it.each([
    ["I need another corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3", "his cash drawer was short $20 on 11/3"],
    ["I need another corrective action for Corwin Ashgrove for his cash drawer being short $20 on 11/3", "his cash drawer being short $20 on 11/3"],
    ["now make a separate CA for Corwin Ashgrove for his cash drawer being short $20 on 11/3", "his cash drawer being short $20 on 11/3"],
    ["create one more ca for Corwin Ashgrove, he was late on 11/4", "he was late on 11/4"],
  ])("on: %s → the account", (said, account) => {
    production();
    vi.stubEnv("ANOTHER_REQUEST_LEAD_ENABLED", "true");
    expect(managerAccount(said, NAME)).toBe(account);
  });

  it.each(["create a corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3", "she did another shift without clocking in", "he worked a separate shift on 11/4"])(
    "on: %s, as before",
    (said) => {
      production();
      const before = managerAccount(said, NAME);
      vi.stubEnv("ANOTHER_REQUEST_LEAD_ENABLED", "true");
      expect(managerAccount(said, NAME)).toBe(before);
    },
  );
});
