import { afterEach, describe, expect, it, vi } from "vitest";

import { cardAccountText } from "./account-spelling";

/* ACCOUNT_TYPOS_FIXED_ENABLED (QA, the Sunny sanitation report, 10 Nov 2026 18:49Z). The manager's words; the person invented. */
describe("ACCOUNT_TYPOS_FIXED_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = (value: boolean) => vi.stubEnv("ACCOUNT_TYPOS_FIXED_ENABLED", value ? "true" : "");

  it(`"not doing th e10 minute sanitaion" reads "not doing the 10-minute sanitation"`, () => {
    on(true);
    expect(cardAccountText("not doing th e10 minute sanitaion", "Brisa Talmadge")).toBe("not doing the 10-minute sanitation");
  });

  it("the manager's words are kept: nothing reworded, a name never corrected, dates left as typed", () => {
    on(true);
    expect(cardAccountText("Brisa was late on 10/20 and did not clean the beds", "Brisa Talmadge")).toBe("Brisa was late on 10/20 and did not clean the beds");
    expect(cardAccountText("she left at 5 minutes to close", null)).toBe("she left at 5 minutes to close");
  });

  it("off: as written", () => {
    on(false);
    expect(cardAccountText("not doing th e10 minute sanitaion", "Brisa Talmadge")).toBe("not doing th e10 minute sanitaion");
  });
});
