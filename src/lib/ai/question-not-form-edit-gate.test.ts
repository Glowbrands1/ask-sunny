import { describe, expect, it } from "vitest";

import { isQuestionNotForm, readQuestion } from "./question-not-form";

/**
 * `readQuestion`: `isQuestionNotForm` with the branch that decided it. Since
 * Pau's ruling A3 (4 Nov 2026) it no longer gates the edit tool — `edit_form`
 * is offered on any turn with a draft open — and is kept only for the trace.
 * The `ABLE_TO_ACT` reading ("is it possible to <action>") and its option
 * were removed with that ruling: no phrase list or regex decides the offer.
 * The wordings are QA's and Pau's (4 Nov 2026). Ported from Ask Bubbles
 * (899438b5); the same reader in both apps.
 */
const EDITS: readonly [string, string][] = [
  ["can you change her last name to Laine?", "ASKED_TO_ACT"],
  ["could you add that she was also late on Tuesday?", "ASKED_TO_ACT"],
  ["would you make it sound more professional?", "ASKED_TO_ACT"],
  ["can you set the daily stats to 3 of 4 shifts on time?", "ASKED_TO_ACT"],
];
const QUESTIONS = ["what policy does that fall under?", "what is the policy on being late?", "can you tell me what the expectation is?"];

describe("readQuestion (the trace's gate branch)", () => {
  for (const [said, branch] of EDITS) {
    it(`"${said}" is a request (${branch})`, () => {
      expect(readQuestion(said)).toEqual({ question: false, branch });
    });
  }
  for (const said of QUESTIONS) {
    it(`"${said}" is a question (ASKS)`, () => {
      expect(readQuestion(said)).toEqual({ question: true, branch: "ASKS" });
    });
  }

  it('"is it possible to change the date to 10/20?" reads as a question (ASKS), as for every other path — Pau\'s ruling A3 removed ABLE_TO_ACT; the edit tool is offered on it anyway', () => {
    // Changed on purpose (Pau's ruling A3): before, the tool's gate read it as ABLE_TO_ACT.
    expect(readQuestion("is it possible to change the date to 10/20?")).toEqual({ question: true, branch: "ASKS" });
  });

  it("its question is isQuestionNotForm exactly", () => {
    for (const said of [...EDITS.map(([text]) => text), ...QUESTIONS, "is it possible to change the date to 10/20?"]) {
      expect(readQuestion(said).question, said).toBe(isQuestionNotForm(said));
    }
  });
});
