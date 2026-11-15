import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/types";

vi.mock("server-only", () => ({}));

const { formsOnFileAsked } = await import("./tools");

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
    expect(formsOnFileAsked({ question: "open my coaching form for remy calder", history: [], questionMessageId: "q1" }, { message_id: "q1", quote: "open my coaching form" })).toEqual({ ok: true });
  });

  it("ok: the asking message a turn before (\"the 10/31 one…\" answering the app's which-form question)", () => {
    expect(formsOnFileAsked({ question: "the 10/31 one", history, questionMessageId: "q2" }, { message_id: "m1", quote: "had any write ups before" })).toEqual({ ok: true });
  });

  it("refused: no evidence, the app's own words, or words the manager never typed", () => {
    expect(formsOnFileAsked({ question: "she was late again", history, questionMessageId: "q2" }, undefined)).toEqual({ ok: false, reason: "evidence_not_manager_turn" });
    expect(formsOnFileAsked({ question: "she was late again", history, questionMessageId: "q2" }, { message_id: "m2", quote: "Coaching Forms on file" })).toEqual({ ok: false, reason: "evidence_not_manager_turn" });
    expect(formsOnFileAsked({ question: "she was late again", history, questionMessageId: "q2" }, { message_id: "q2", quote: "show me her write ups" })).toEqual({ ok: false, reason: "evidence_quote_not_found" });
  });

  it("refused: an ask more than three manager messages back no longer opens forms on file", () => {
    const long = [...history, turn("m3", "user", "ok"), turn("m4", "assistant", "Sure."), turn("m5", "user", "new topic"), turn("m6", "assistant", "Go on.")];
    expect(formsOnFileAsked({ question: "coaching for juno paxton", history: long, questionMessageId: "q9" }, { message_id: "m1", quote: "had any write ups before" })).toEqual({ ok: false, reason: "evidence_not_this_turn" });
  });
});
