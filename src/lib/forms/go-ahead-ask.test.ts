import { afterEach, describe, expect, it, vi } from "vitest";

import { GO_AHEAD_ASK, withGoAheadAsk } from "./go-ahead-ask";

/* GO_AHEAD_ASKS_WHO_AND_FORM_ENABLED (QA's r37 live check, 12 Nov 2026; low): QA's turns. */
const POLICY = [{ role: "user", content: "cite the animals in the workplace policy" }, { role: "assistant", content: "A grounded answer." }];
const ANSWER = { content: "I need two things first: which employee this is for, and you'll need to ask for it by name." };

describe("GO_AHEAD_ASKS_WHO_AND_FORM", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("on: \"just make it\" after a policy question is one short question", () => {
    vi.stubEnv("GO_AHEAD_ASKS_WHO_AND_FORM_ENABLED", "true");
    expect(withGoAheadAsk(ANSWER, POLICY, "just make it").content).toBe(GO_AHEAD_ASK);
    expect(withGoAheadAsk(ANSWER, POLICY, "ok make it").content).toBe(GO_AHEAD_ASK);
  });

  it("on: a card or a form request in the chat, no policy named, or not a go-ahead: as given", () => {
    vi.stubEnv("GO_AHEAD_ASKS_WHO_AND_FORM_ENABLED", "true");
    expect(withGoAheadAsk(ANSWER, [...POLICY, { role: "assistant", content: "card", formProposal: {} }], "just make it")).toBe(ANSWER);
    expect(withGoAheadAsk(ANSWER, [{ role: "user", content: "create a coaching form for Wren Tallis, cite the dress code policy" }], "just make it")).toBe(ANSWER);
    expect(withGoAheadAsk(ANSWER, [{ role: "user", content: "what are the store hours" }], "just make it")).toBe(ANSWER);
    expect(withGoAheadAsk(ANSWER, POLICY, "what does it say about service dogs")).toBe(ANSWER);
    expect(withGoAheadAsk({ ...ANSWER, formProposal: { employeeName: null } }, POLICY, "just make it").content).toBe(ANSWER.content);
  });

  it("off: as given", () => {
    vi.stubEnv("GO_AHEAD_ASKS_WHO_AND_FORM_ENABLED", "");
    expect(withGoAheadAsk(ANSWER, POLICY, "just make it")).toBe(ANSWER);
  });
});
