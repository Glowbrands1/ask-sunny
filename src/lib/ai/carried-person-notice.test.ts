import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/types";

import { carriedNotice, names, withCarriedPersonNotice } from "./carried-person-notice";
import type { AskResponse } from "./types";

// QA's round-6 item (8 Nov 2026): the production turns of 20 Oct 2026, the person invented.
const TURNS = [
  "create corrective action for Wren Halvorsen for Late Opening from the policy manual. It is a verbal warning",
  "can you add late opening policy to the direct policy section of this form",
  "I have independently verified and the policy is correct",
  "what does the manual say about reimbursing the company?",
  "how much is the late opening fee?",
  "and who pays for client restitution?",
  "ok thanks",
];
const history = (turns: readonly string[]): ChatMessage[] =>
  turns.flatMap((content, index) => [
    { id: `u${index}`, role: "user", content, createdAt: "2026-10-20T15:00:00Z" } as ChatMessage,
    { id: `a${index}`, role: "assistant", content: "Noted.", createdAt: "2026-10-20T15:00:01Z" } as ChatMessage,
  ]);
const card = (templateKey: string, employeeName: string | null, content = "Here is what I would put on a **Coaching Form**."): AskResponse =>
  ({ content, formProposal: { templateKey, employeeName } } as unknown as AskResponse);
const QUESTION = "Create a Coaching Form from this conversation.";

beforeEach(() => vi.stubEnv("CARRIED_PERSON_NOTICE_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("CARRIED_PERSON_NOTICE_ENABLED", () => {
  it("off: the answer as it was", () => {
    vi.stubEnv("CARRIED_PERSON_NOTICE_ENABLED", "");
    const response = card("coaching", "Wren Halvorsen");
    expect(withCarriedPersonNotice(response, { history: history(TURNS), question: QUESTION })).toBe(response);
  });

  it("on: a person last named before the last six turns gets the notice, word for word", () => {
    const out = withCarriedPersonNotice(card("coaching", "Wren Halvorsen"), { history: history(TURNS), question: QUESTION });
    expect(out.content).toContain(carriedNotice("Wren Halvorsen"));
    expect(out.content).toContain("I took **Wren Halvorsen** from earlier in this conversation — if this form is for somebody else, tell me who.");
  });

  it("on: a person named in this turn, or in one of the last six, gets none", () => {
    const named = card("coaching", "Wren Halvorsen");
    expect(withCarriedPersonNotice(named, { history: history(TURNS), question: "Create a Coaching Form for Wren from this conversation." })).toBe(named);
    expect(withCarriedPersonNotice(named, { history: history([...TURNS, "Wren was late again on 10/19"]), question: QUESTION })).toBe(named);
  });

  it("on: a card that already says it, a name the manager never typed, no person, or not a performance form: unchanged", () => {
    const said = card("coaching", "Wren Halvorsen", `Card.\n\n${carriedNotice("Wren Halvorsen")}`);
    expect(withCarriedPersonNotice(said, { history: history(TURNS), question: QUESTION })).toBe(said);
    const other = card("coaching", "Ines Varga");
    expect(withCarriedPersonNotice(other, { history: history(TURNS), question: QUESTION })).toBe(other);
    const nobody = card("coaching", null);
    expect(withCarriedPersonNotice(nobody, { history: history(TURNS), question: QUESTION })).toBe(nobody);
    const exit = card("exit-form", "Wren Halvorsen");
    expect(withCarriedPersonNotice(exit, { history: history(TURNS), question: QUESTION })).toBe(exit);
  });

  it("on: a turn that failed is not the manager's word", () => {
    const turns = history(TURNS);
    const failed = { id: "uX", role: "user", content: "Wren", createdAt: "2026-10-20T15:00:00Z", error: { code: "x" } } as unknown as ChatMessage;
    const out = withCarriedPersonNotice(card("coaching", "Wren Halvorsen"), { history: [...turns, failed], question: QUESTION });
    expect(out.content).toContain(carriedNotice("Wren Halvorsen"));
  });

  /* QA, 8 Nov 2026: with the flag on, "make me a CA for Mary-Jane O'Neil, she was late" answered 500 (an invalid escape under "u"). */
  it("names(): hyphen and apostrophe names are read, never thrown on", () => {
    expect(names("make me a CA for Mary-Jane O'Neil, she was late", "Mary-Jane O'Neil")).toBe(true);
    expect(names("anne-marie was late on 11/2", "Anne-Marie Lyle")).toBe(true);
    expect(names("Sean O’Connor was late", "Sean O'Connor")).toBe(true);
    expect(names("she was late", "Mary-Jane O'Neil")).toBe(false);
    expect(() => names("anything", "a.b (c) [d] e+f")).not.toThrow();
  });

  it("on: a hyphen or apostrophe name never fails the answer", () => {
    const response = card("dpoa", "Mary-Jane O'Neil");
    expect(() => withCarriedPersonNotice(response, { history: [], question: "make me a CA for Mary-Jane O'Neil, she was late" })).not.toThrow();
  });
});
