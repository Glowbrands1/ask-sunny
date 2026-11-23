import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/types";

vi.mock("server-only", () => ({}));

const { formsOnFileAsked, nameCorrectionRefusal } = await import("./tools");

/*
 * PAST FORMS ONLY WHEN ASKED, by evidence (the rebuild plan's PR 1; replaces privacy-gate.test.ts and
 * past-forms-gate.test.ts, which tested the word lists that are gone). The model decides what asking means; code
 * checks the manager's words are really in one of their last three messages. People are invented.
 */
const turn = (id: string, role: "user" | "assistant", content: string) => ({ id, role, content }) as unknown as ChatMessage;

describe("formsOnFileAsked", () => {
  const history = [
    turn("m1", "user", "has remy calder had any write ups before?"),
    turn("m2", "assistant", "Remy Calder has two Coaching Forms on file:\n- 10/31\n- 11/5\n\nWhich one should I open?"),
  ];

  it("ok: the manager's own words, in this message", () => {
    expect(formsOnFileAsked({ question: "open my coaching form for remy calder", history: [], questionMessageId: "q1" }, { message_id: "q1", quote: "open my coaching form" })).toMatchObject({ ok: true });
  });

  it("ok: the asking message a turn before (\"the 10/31 one…\" answering the app's which-form question)", () => {
    expect(formsOnFileAsked({ question: "the 10/31 one", history, questionMessageId: "q2" }, { message_id: "m1", quote: "had any write ups before" })).toMatchObject({ ok: true });
  });

  it("refused: no evidence, the app's own words, or words the manager never typed", () => {
    expect(formsOnFileAsked({ question: "she was late again", history, questionMessageId: "q2" }, undefined)).toEqual({ ok: false, reason: "evidence_not_manager_turn" });
    expect(formsOnFileAsked({ question: "she was late again", history, questionMessageId: "q2" }, { message_id: "q2", quote: "show me her write ups" })).toEqual({ ok: false, reason: "evidence_quote_not_found" });
  });

  /*
   * Changed on purpose (22 Nov 2026, port of Ask Bubbles #1059, its QA's follow-up): the app's own question RIGHT BEFORE
   * the manager's current message, quoted under that question's id or the current one's, is evidence; the ask is then
   * the manager's reply. This line used to expect "evidence_not_manager_turn" for m2's words; the app's words from any
   * earlier turn are still refused (below), and the person check (formsOnFileAskedFor) still decides whose forms.
   */
  it("ok: the app's own question right before this message, quoted under its id or this message's", () => {
    expect(formsOnFileAsked({ question: "yes please", history, questionMessageId: "q2" }, { message_id: "m2", quote: "Coaching Forms on file" })).toMatchObject({ ok: true, said: "yes please" });
    expect(formsOnFileAsked({ question: "yes please", history, questionMessageId: "q2" }, { message_id: "q2", quote: "Which one should I open" })).toMatchObject({ ok: true, said: "yes please" });
  });

  it("refused: the app's words from an earlier turn, or a quote not in the app's question", () => {
    const later = [...history, turn("m3", "user", "ok"), turn("m4", "assistant", "Sure.")];
    expect(formsOnFileAsked({ question: "yes please", history: later, questionMessageId: "q3" }, { message_id: "m2", quote: "Coaching Forms on file" })).toEqual({ ok: false, reason: "evidence_not_manager_turn" });
    expect(formsOnFileAsked({ question: "yes please", history, questionMessageId: "q2" }, { message_id: "m2", quote: "Juno Paxton's forms" })).toEqual({ ok: false, reason: "evidence_not_manager_turn" });
  });

  it("refused: an ask more than three manager messages back no longer opens forms on file", () => {
    const long = [...history, turn("m3", "user", "ok"), turn("m4", "assistant", "Sure."), turn("m5", "user", "new topic"), turn("m6", "assistant", "Go on.")];
    expect(formsOnFileAsked({ question: "coaching for juno paxton", history: long, questionMessageId: "q9" }, { message_id: "m1", quote: "had any write ups before" })).toEqual({ ok: false, reason: "evidence_not_this_turn" });
  });
});

/* QA's review of PR 1a, ruling 2: every employee_name write is a quoted name correction (invented people). */
describe("nameCorrectionRefusal", () => {
  const person = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName, preferredFirstName: null, salonIds: ["loc-0309"] });
  const roster = { kind: "read" as const, roster: [person("e-2", "Remy", "Calder"), person("e-3", "Juno", "Paxton")] };
  it("allows the new spelling the manager typed", () => {
    expect(nameCorrectionRefusal("Remy Calder", "Remy Calder-Voss", "it is Calder-Voss", roster)).toBeNull();
  });
  it("asks about a close spelling of the form's own person, with keep-as-typed (ruling A; QA's re-review fix 3)", () => {
    const asked = nameCorrectionRefusal("Remy Calder", "Remy Kalder", "her last name is Kalder", roster);
    expect(asked).toMatchObject({ reason_code: "name_correction_did_you_mean" });
    expect(String((asked as { error: string }).error)).toMatch(/Did you mean \*\*Remy Calder\*\*\?[\s\S]*"no" to keep \*\*Remy Kalder\*\*/);
    expect(nameCorrectionRefusal("Remy Calder", "Remy Kalder", "her last name is Kalder", roster, { keepAsTyped: true })).toBeNull();
  });
  it("refuses a name the quote does not hold", () => {
    expect(nameCorrectionRefusal("Remy Calder", "Juno Paxton", "fix her last name please", roster)).toMatchObject({ reason_code: "name_not_in_evidence" });
  });
  it("refuses another roster person's name, quoted or not", () => {
    expect(nameCorrectionRefusal("Remy Calder", "Juno Paxton", "it should be Juno Paxton", roster)).toMatchObject({ reason_code: "name_correction_other_person" });
  });
  it("asks when the new name is a close spelling of someone else (a near miss is never seated)", () => {
    expect(nameCorrectionRefusal("Remy Calder", "Juno Paxtin", "her name is Juno Paxtin", roster)).toMatchObject({ reason_code: "name_correction_did_you_mean" });
  });
});
