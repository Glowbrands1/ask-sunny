import { afterEach, describe, expect, it } from "vitest";

import { sameRequestKind } from "./same-request-other-person";

/* SAME_REQUEST_TITLE_ACCOUNT_ENABLED. QA's wording (B22-2, #233). The replay cases run the route. */
describe("SAME_REQUEST_TITLE_ACCOUNT_ENABLED", () => {
  afterEach(() => {
    delete process.env.SAME_REQUEST_TITLE_ACCOUNT_ENABLED;
  });

  it("off: \"now one for <B>, <title>, late today\" is not read (as main)", () => {
    expect(sameRequestKind("now one for Test Employee Two, tanning consultant, late today")).toBeNull();
  });

  it.each(["now one for Test Employee Two, tanning consultant, late today", "NOW ONE FOR TEST EMPLOYEE TWO, TANNING CONSULTANT, LATE TODAY", "also one for Mara Quell, assistant salon director, no call no show yesterday"])(
    "on: %s is <B>'s own request",
    (said) => {
      process.env.SAME_REQUEST_TITLE_ACCOUNT_ENABLED = "true";
      expect(sameRequestKind(said)).toBe("own");
    },
  );

  it.each(["now one for Test Employee Two, tanning consultant, thanks", "now one for Test Employee Two, tanning consultant"])("on, no account: %s is not", (said) => {
    process.env.SAME_REQUEST_TITLE_ACCOUNT_ENABLED = "true";
    expect(sameRequestKind(said)).not.toBe("own");
  });
});
