import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withFirstNameSuggest } from "./first-name-suggest";
import type { AskRequest, AskResponse } from "./types";
import type { RosterEmployee } from "@/lib/forms/employee-match";

/*
 * QA review, 28 Oct 2026: "Also confirm the Did-you-mean path and
 * activeFormInstanceId (card already created) never re-asks." A card filled
 * with a full name from a first name alone is not asked about when a form is
 * already open, an earlier reply named the person in bold, or an earlier card
 * was for them. Invented names.
 */
const ROSTER = [
  { id: "e-7", firstName: "Katrin", lastName: "Dovetail", preferredFirstName: null },
  { id: "e-3", firstName: "Rowan", lastName: "Kestrel", preferredFirstName: null },
] as unknown as RosterEmployee[];
const CARD: AskResponse = {
  content: "I'll draft a Corrective Action Form for Katrin Dovetail.",
  formProposal: { employeeName: "Katrin Dovetail" },
} as unknown as AskResponse;

function request(over: Partial<AskRequest> = {}, assistant = "Got it."): AskRequest {
  return {
    question: "make it a written warning",
    history: [
      { id: "m1", role: "user", content: "katrin was late on 10/20, write her up" },
      { id: "a1", role: "assistant", content: assistant },
    ],
    ...over,
  } as unknown as AskRequest;
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.FIRST_NAME_SUGGEST_ENABLED;
  process.env.FIRST_NAME_SUGGEST_ENABLED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.FIRST_NAME_SUGGEST_ENABLED;
  else process.env.FIRST_NAME_SUGGEST_ENABLED = saved;
});

describe("a card filled from a first name alone", () => {
  it("is asked about when nothing confirmed the person", () => {
    expect(withFirstNameSuggest(CARD, request(), ROSTER).content).toBe("Is this for **Katrin Dovetail**? Tell me if that should change.");
  });

  it("is not asked about with a form already open (activeFormInstanceId)", () => {
    expect(withFirstNameSuggest(CARD, request({ activeFormInstanceId: "f-1" }), ROSTER)).toBe(CARD);
  });

  it("is not asked about when an earlier reply named them in bold (a numbered Did you mean)", () => {
    const named = request({}, "Did you mean 1. **Katrin Dovetail** 2. **Katrin Ashby**?");
    named.history.push(
      { id: "m2", role: "user", content: "1" } as never,
      { id: "a2", role: "assistant", content: "I'll draft it." } as never,
    );
    expect(withFirstNameSuggest(CARD, named, ROSTER)).toBe(CARD);
  });

  it("is not asked about when an earlier card was for them", () => {
    const carded = request();
    (carded.history[1] as { formProposal?: unknown }).formProposal = { employeeName: "Katrin Dovetail" };
    expect(withFirstNameSuggest(CARD, carded, ROSTER)).toBe(CARD);
  });
});
