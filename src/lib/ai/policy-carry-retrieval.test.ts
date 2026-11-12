import { afterEach, describe, expect, it, vi } from "vitest";

import { carriedPolicyTopic, isGoAheadTurn } from "./policy-carry-retrieval";

/**
 * POLICY_CARRY_RETRIEVAL_ENABLED (QA item 10; reported in Ask Bubbles' production, 25 Oct 2026; #248 rebuilt on main,
 * 12 Nov 2026). The manager's turns, names invented: T2 "cite animals in the workplace policy" was answered from
 * Animals in the Workplace p.30; T4 "just make it" was searched on its own words and the reply denied the policy. The
 * search itself (`ai/server-ask.ts`, Coding-2's file) reads `carriedPolicyTopic`; these are the reader's own cases.
 */
const T1 =
  "do verbl for Wren Okafor at Larkfield. no payrol deduct. prev coachng jba manual 11-1-25. on 10-22-26 Wren wasnt scheduled and came in to show her puppy 45 min";
const T2 = "cite animals in the workplace policy";
const T3 = "I already told you the salon is Larkfield";
const HISTORY = [
  { role: "user", content: T1 },
  { role: "assistant", content: "Which salon is this actually for? I won't guess." },
  { role: "user", content: T2 },
  { role: "assistant", content: "Animals in the Workplace: The Company doesn't allow pets in the workplace [p.30]." },
  { role: "user", content: T3 },
  { role: "assistant", content: "Got it. Say \"create a coaching form for Wren Okafor\" and I'll bring up the draft." },
];

afterEach(() => vi.unstubAllEnvs());

describe("T4 \"just make it\"", () => {
  it("off: no carried topic (searched as before)", () => {
    // Port from Ask Bubbles (R819, QA, 12 Nov 2026): the off arm stubs its own flag.
    vi.stubEnv("POLICY_CARRY_RETRIEVAL_ENABLED", "");
    expect(carriedPolicyTopic("just make it", HISTORY)).toBeNull();
  });

  it("on: the turn that named the policy is the topic", () => {
    vi.stubEnv("POLICY_CARRY_RETRIEVAL_ENABLED", "true");
    expect(carriedPolicyTopic("just make it", HISTORY)).toBe(T2);
  });

  it("on: a turn with its own topic carries nothing", () => {
    vi.stubEnv("POLICY_CARRY_RETRIEVAL_ENABLED", "true");
    expect(carriedPolicyTopic("what is the dress code policy?", HISTORY)).toBeNull();
  });
});

describe("which turns only say to go ahead", () => {
  it.each(["just make it", "make it", "create it", "do it", "yes", "ok go ahead", "just make the form", "create the draft now", "please do it"])(
    "%s",
    (turn) => expect(isGoAheadTurn(turn)).toBe(true),
  );

  it.each([
    "make it a written warning",
    "create a coaching form for Wren Okafor",
    "just make it say she was late",
    "what is the dress code policy?",
    T3,
  ])("%s carries its own topic", (turn) => expect(isGoAheadTurn(turn)).toBe(false));

  it("with no policy named earlier, the latest topic turn is searched; never an assistant turn", () => {
    vi.stubEnv("POLICY_CARRY_RETRIEVAL_ENABLED", "true");
    expect(carriedPolicyTopic("do it", [{ role: "user", content: "Wren was rude to a guest" }])).toBe("Wren was rude to a guest");
    expect(carriedPolicyTopic("do it", [{ role: "assistant", content: "the visitors policy" }])).toBeNull();
  });
});

/* HOW MANAGERS TYPE (Pau, 26 Oct 2026): the same reading in all lowercase and in sentence case. */
const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

describe("every register of a go-ahead", () => {
  it.each(["just make it", "Just make it", "JUST MAKE IT", "do it", "Do it", "make it already", "Ok go ahead"])("%s", (turn) => {
    expect(isGoAheadTurn(turn)).toBe(true);
  });

  it.each([T2, lower(T2), sentence(T2)])("on: the policy turn in any case is the topic (%s)", (policyTurn) => {
    vi.stubEnv("POLICY_CARRY_RETRIEVAL_ENABLED", "true");
    expect(carriedPolicyTopic("just make it", [{ role: "user", content: policyTurn }])).toBe(policyTurn);
  });
});
