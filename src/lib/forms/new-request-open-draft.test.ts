import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newRequestForOpenDraft } from "./new-request-open-draft";

/**
 * NEW_REQUEST_OPEN_DRAFT_ENABLED — QA's live check, 3 Nov 2026, with the
 * tester's words and an invented person.
 */
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.NEW_REQUEST_OPEN_DRAFT_ENABLED;
  process.env.NEW_REQUEST_OPEN_DRAFT_ENABLED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.NEW_REQUEST_OPEN_DRAFT_ENABLED;
  else process.env.NEW_REQUEST_OPEN_DRAFT_ENABLED = saved;
});

const HISTORY = [
  { role: "user", content: "a CA" },
  { role: "assistant", content: "Who is this form for?" },
  { role: "user", content: "Remy Calder failed to take trash out and put rugs out untl 12;30pm" },
  { role: "assistant", content: "Here is what I would put on a Corrective Action Form." },
];
const open = (question: string, employeeName = "Remy Calder") => newRequestForOpenDraft({ question, history: HISTORY, employeeName });

describe("with her draft open", () => {
  it("the tester's words: a new request, a new card", () => {
    expect(open("make me a CA for Remy Calder for being late to opening this morning")).toBe(true);
  });

  for (const question of [
    "a CA for Remy Calder",
    "she also left the back door unlocked",
    "make me a CA for Remy Calder for failing to take trash out and put rugs out",
    "what policy does that fall under?",
  ]) {
    it(`${JSON.stringify(question)}: about the open draft, as before`, () => {
      expect(open(question)).toBe(false);
    });
  }

  it("a request for somebody else is not hers", () => {
    expect(open("make me a CA for Juno Paxton for being late to opening this morning")).toBe(false);
  });

  it("off: never", () => {
    process.env.NEW_REQUEST_OPEN_DRAFT_ENABLED = "false";
    expect(open("make me a CA for Remy Calder for being late to opening this morning")).toBe(false);
  });
});
