import { describe, expect, it } from "vitest";

import { CLAIMS_A_CHANGE } from "./run";

/* The no-false-"updated" guard's reading (agent-loop/run.ts): which replies claim the form changed. */
describe("a reply that claims the form changed", () => {
  it.each([
    "I've added that to the Observation.",
    "I updated the draft with what Rowan did.",
    "Done — the observation now reads: Rowan marked a session as complete.",
    "The draft now says she was late on 11/5.",
    "That detail has been added to the form.",
  ])("claims: %s", (reply) => expect(CLAIMS_A_CHANGE.test(reply)).toBe(true));
  it.each([
    "No — there's no policy on the draft yet. The draft has Remy Calder, NE Kearney, dated today.",
    "I wasn't able to get that onto the draft — the form came back unchanged.",
    "The card still only has Rowan Kestrel, NE Kearney, 10/26/2026.",
    "Who is the corrective action for?",
  ])("does not claim: %s", (reply) => expect(CLAIMS_A_CHANGE.test(reply)).toBe(false));
});
