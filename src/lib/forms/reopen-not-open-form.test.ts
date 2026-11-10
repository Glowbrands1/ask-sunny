import { describe, expect, it } from "vitest";

import { leadsWithReopenRequest } from "./reopen-request";

/**
 * REOPEN_NOT_OPEN_FORM_ENABLED (QA's Sunny round-4 gate, 8 Nov 2026): the reopen verb counts as the request only at the
 * start of the turn. The person is invented.
 */
describe("leadsWithReopenRequest", () => {
  it.each([
    "show me the draft",
    "can you show me the corrective action for Sabeline Delacourt",
    "open her CA",
    "please bring up the coaching form",
    "pull up Sabeline's CA",
    "edit the form",
    "I want to see the draft",
  ])("%s → the request itself", (question) => {
    expect(leadsWithReopenRequest(question)).toBe(true);
  });

  it.each([
    "I need the CA for the Must see behaviors and not the standard of conduct. Make it in the format that I explained above in the first chat for Sabeline.",
    "make it in the format I explained above so I can see it",
    "she did not follow the must see behaviors",
  ])("%s → a word inside an edit, not the request", (question) => {
    expect(leadsWithReopenRequest(question)).toBe(false);
  });
});
