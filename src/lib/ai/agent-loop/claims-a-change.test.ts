import { describe, expect, it } from "vitest";

import { CLAIMS_A_CHANGE, DISOWNS_EARLIER_CARD } from "./run";

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

/* The earlier-card guard (agent-loop/run.ts, live re-run 14 Nov 2026): a sentence disowning an earlier card is dropped. */
describe("a sentence that says an earlier card was not real", () => {
  const drop = (reply: string) => reply.replace(DISOWNS_EARLIER_CARD, "").trim();
  it("drops the live run's sentences", () => {
    expect(drop("One correction: my earlier message showed the card before I'd actually built it. Here's the draft — press Create.")).toBe("Here's the draft — press Create.");
    expect(drop("One correction first: my earlier reply went out before I'd checked the roster or the manual — here's the card.")).toBe("");
    expect(drop("I should be straight with you: my earlier replies described cards that were never actually drafted. This one is real.")).toBe("This one is real.");
  });
  it.each([
    "Here is the card. Your last message never said the date, so which date?",
    "The last card was never created; press Create when it looks right.",
    "I updated the card from my earlier reply.",
  ])("keeps: %s", (reply) => expect(drop(reply)).toBe(reply));
});
