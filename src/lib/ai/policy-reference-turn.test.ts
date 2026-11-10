import { afterEach, describe, expect, it } from "vitest";

import { isPolicyReference, withoutPolicyReferenceTurns } from "./policy-reference-turn";

/*
 * POLICY_REFERENCE_NOT_ACCOUNT_ENABLED. The managers' words are verbatim (QA's overnight scan, 4 Nov 2026: sf-s16,
 * sf-s17); the people are invented. The replay pack runs the same chats: `nov4-overnight-scan-cases.ts`.
 */

const S16 = "In the past we have quoted the standards of conduct for creating a ca due to underperformance";
const S17 = "you can reference the standards of conduct for a policy";
const S16_REQUEST = "put together a corrective action for Calista Venn due to under performance in salon metrics for the month of october";
const S17_REQUEST = "put together a written CA for Marit Sollano for not compelting her woven courses by the deadline of october 31st";

afterEach(() => {
  delete process.env.POLICY_REFERENCE_NOT_ACCOUNT_ENABLED;
});

describe("a turn that only says which policy to cite", () => {
  it("reads both reported wordings, and never an account", () => {
    expect(isPolicyReference(S16)).toBe(true);
    expect(isPolicyReference(S17)).toBe(true);
    expect(isPolicyReference(S16_REQUEST)).toBe(false);
    expect(isPolicyReference("she did not follow the attendance policy and she was late again")).toBe(false);
    expect(isPolicyReference("She was rude to a guest, use the standards of conduct")).toBe(false);
  });

  it("is left out of the draft's account with the flag on; as before with it off; never empties the notes", () => {
    expect(withoutPolicyReferenceTurns(`${S16_REQUEST}\n\n${S16}`)).toBe(`${S16_REQUEST}\n\n${S16}`);
    process.env.POLICY_REFERENCE_NOT_ACCOUNT_ENABLED = "true";
    expect(withoutPolicyReferenceTurns(`${S16_REQUEST}\n\n${S16}`)).toBe(S16_REQUEST);
    expect(withoutPolicyReferenceTurns(`${S17_REQUEST}\n\n${S17}`)).toBe(S17_REQUEST);
    expect(withoutPolicyReferenceTurns(S17)).toBe(S17);
  });
});
