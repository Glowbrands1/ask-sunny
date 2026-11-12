import { afterEach, describe, expect, it } from "vitest";

import { observationShows, withAccountTurnSources } from "./account-turn-sources";

/*
 * ACCOUNT_BEFORE_REQUEST_ENABLED. A manager's production chat (relayed 5 Nov 2026), verbatim; the person is invented
 * (Rowan Kestrel). The replay case `nov5-coding3-account-before-the-request-reaches-the-draft` runs the chat.
 */
const ACCOUNT = "rowan marked a session as complete but the guest hadn't been sprayed yet";
const CARD = [
  "Here is what I would put on a **Coaching Form**.",
  "**Job title:** Tanning Consultant",
  "**Observation of Offense:** rowan marked a session as complete but the guest hadn't been sprayed yet Rowan Kestrel marked a session as complete but the guest hadn't been sprayed yet Create a coaching form.",
].join("\n\n");
const HISTORY = [
  { id: "m1", role: "user", content: ACCOUNT },
  { id: "a1", role: "assistant", content: "A grounded answer from the policy manual." },
  { id: "m2", role: "user", content: "Create a coaching form." },
  { id: "a2", role: "assistant", content: "Is this for **Rowan Kestrel**? Tell me if that should change." },
];
const answer = (sources: string[]) => ({ content: CARD, formProposal: { templateKey: "coaching", sourceMessageIds: sources } as unknown as import("@/types").ChatFormProposal });

afterEach(() => {
  delete process.env.ACCOUNT_BEFORE_REQUEST_ENABLED;
});

describe("the account a card shows, given before its request", () => {
  it("is cited with the flag on; as before off", () => {
    expect(withAccountTurnSources(answer(["m2", "m3"]), HISTORY).formProposal!.sourceMessageIds).toEqual(["m2", "m3"]);
    process.env.ACCOUNT_BEFORE_REQUEST_ENABLED = "true";
    expect(withAccountTurnSources(answer(["m2", "m3"]), HISTORY).formProposal!.sourceMessageIds).toEqual(["m1", "m2", "m3"]);
    // The card cites only this turn: every earlier turn is before it.
    expect(withAccountTurnSources(answer(["m3"]), HISTORY).formProposal!.sourceMessageIds).toEqual(["m1", "m3"]);
  });

  it("a card saved before sourceMessageIds existed is left as it is, flag on or off (QA's round-23 gate)", () => {
    const old = { content: CARD, formProposal: { templateKey: "coaching" } as unknown as import("@/types").ChatFormProposal };
    expect(withAccountTurnSources(old, HISTORY)).toBe(old);
    process.env.ACCOUNT_BEFORE_REQUEST_ENABLED = "true";
    expect(() => withAccountTurnSources(old, HISTORY)).not.toThrow();
    expect(withAccountTurnSources(old, HISTORY)).toBe(old);
    const notAnArray = { content: CARD, formProposal: { templateKey: "coaching", sourceMessageIds: null } as unknown as import("@/types").ChatFormProposal };
    expect(withAccountTurnSources(notAnArray, HISTORY)).toBe(notAnArray);
  });

  it("is only a turn the Observation shows in full", () => {
    expect(observationShows(CARD, ACCOUNT)).toBe(true);
    expect(observationShows(CARD, "she was late to opening on 10/12 and left the door unlocked")).toBe(false);
    expect(observationShows(CARD, "Create a coaching form.")).toBe(false);
  });
});
