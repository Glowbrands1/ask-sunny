import { describe, expect, it } from "vitest";

import { isQuestionNotForm, readQuestion } from "./question-not-form";

/**
 * FORM_EDIT_TOOL_IN_STREAM_ENABLED's gate (QA and Pau, 4 Nov 2026): a real
 * edit asked as a question is an edit request, a question is not — decided
 * by the existing readings, no phrase list. Their exact wordings (ported
 * from Ask Bubbles c5534279; the same reader in both apps).
 */
const EDITS: readonly [string, string][] = [
  ["can you change her last name to Laine?", "ASKED_TO_ACT"],
  ["could you add that she was also late on Tuesday?", "ASKED_TO_ACT"],
  ["would you make it sound more professional?", "ASKED_TO_ACT"],
  ["is it possible to change the date to 10/20?", "ABLE_TO_ACT"],
  ["can you set the daily stats to 3 of 4 shifts on time?", "ASKED_TO_ACT"],
];
const QUESTIONS = ["what policy does that fall under?", "what is the policy on being late?", "can you tell me what the expectation is?"];

describe("readQuestion with asksToActAnyAction (the edit tool's gate)", () => {
  for (const [said, branch] of EDITS) {
    it(`"${said}" is an edit request (${branch})`, () => {
      expect(readQuestion(said, [], { asksToActAnyAction: true })).toEqual({ question: false, branch });
    });
  }
  for (const said of QUESTIONS) {
    it(`"${said}" is a question (ASKS)`, () => {
      expect(readQuestion(said, [], { asksToActAnyAction: true })).toEqual({ question: true, branch: "ASKS" });
    });
  }

  it('without the option: as isQuestionNotForm, so "is it possible to change …?" stays a question for every other path (unchanged)', () => {
    for (const said of [...EDITS.map(([text]) => text), ...QUESTIONS]) {
      expect(readQuestion(said).question, said).toBe(isQuestionNotForm(said));
    }
    expect(isQuestionNotForm("is it possible to change the date to 10/20?")).toBe(true);
    expect(readQuestion("is it possible to change the date to 10/20?")).toEqual({ question: true, branch: "ASKS" });
  });
});
