import { describe, expect, it } from "vitest";

import { cardPolicyTurns } from "./card-policy-request";

/**
 * CARD_POLICY_OWN_REQUEST_ENABLED (QA's live tester, Sunny flip 7, 7 Nov 2026): "Coaching form for <A> for being on
 * her phone…", then "Coaching form for <B>": B's card cited Cell Phone/Smart Watch p.19 from A's request.
 * People invented.
 */
const A = "Coaching form for Tamsin Holt for being on her phone";

describe("cardPolicyTurns", () => {
  it("the tester's chat: B's card reads only \"Coaching form for <B>\"", () => {
    expect(cardPolicyTurns([A, "Coaching form for Corwin Hale"], "Corwin Hale")).toEqual(["Coaching form for Corwin Hale"]);
  });

  it("B's request and its follow-ups stay together", () => {
    expect(cardPolicyTurns([A, "Coaching form for Corwin Hale", "he was late to open on 11-2-26"], "Corwin Hale")).toEqual([
      "Coaching form for Corwin Hale",
      "he was late to open on 11-2-26",
    ]);
  });

  it("a polite request for B (sf-s37's wording) is a request too", () => {
    const b = "Can you create me a coaching document for Tilly Marsh for not hitting her numbers for the month of October.";
    expect(cardPolicyTurns([A, b], "Ottilie Marsh")).toEqual([b]);
  });

  it("a form switch with no name keeps every turn (the account's policy stays)", () => {
    const turns = [A, "make it a coaching form instead"];
    expect(cardPolicyTurns(turns, "Tamsin Holt")).toBe(turns);
  });

  it("a second request for the same person keeps every turn (SECOND_REQUEST_OWN_ACCOUNT's case, not this flag's)", () => {
    const turns = [A, "Coaching form for Tamsin Holt"];
    expect(cardPolicyTurns(turns, "Tamsin Holt")).toBe(turns);
  });

  it("one request, or no employee yet: every turn", () => {
    expect(cardPolicyTurns([A], "Tamsin Holt")).toEqual([A]);
    const turns = [A, "Coaching form for Corwin Hale"];
    expect(cardPolicyTurns(turns, null)).toBe(turns);
  });
});
