import { describe, expect, it } from "vitest";

import { withoutAsksToTheApp } from "./asks-to-the-app";

/** GRAMMAR_ASK_NOT_ACCOUNT_ENABLED (QA P5, 27 Oct 2026): what is and is not an ask to the app. */
describe("withoutAsksToTheApp", () => {
  it("drops a grammar request and a question to the app", () => {
    expect(withoutAsksToTheApp("i trained her on the promo. can you clean up my grammar and capitalizing on proper nouns?")).toBe(
      "i trained her on the promo.",
    );
    expect(withoutAsksToTheApp("can you reference the late opening policy instead?")).toBe("");
  });

  it("keeps the account, an added fact, and line breaks", () => {
    expect(withoutAsksToTheApp("add that she was also on her phone.\nshe was late on 10-5.")).toBe(
      "add that she was also on her phone.\nshe was late on 10-5.",
    );
  });
});
