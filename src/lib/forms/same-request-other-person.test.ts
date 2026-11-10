import { afterEach, describe, expect, it } from "vitest";

import type { ChatMessage } from "@/types";

import {
  asksForAnotherPerson,
  notesForOtherPerson,
  sameRequestForOtherPerson,
  sameRequestKind,
  sameRequestReadConversation,
  switchedLevel,
  withSameRequestNote,
} from "./same-request-other-person";
import { requestedForm } from "@/lib/ai/form-type-switch";

/*
 * SAME_REQUEST_OTHER_PERSON_ENABLED. The managers' words are verbatim (QA's overnight scan sf-s11, 4 Nov 2026, and
 * coding3's (a)/(c), 5 Nov 2026); every person is invented. The replay pack runs the same words through the chat route:
 * `nov5-coding3-same-form-other-employee-cases.ts` and `nov4-overnight-scan-cases.ts` (sf-s11).
 */

const person = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName, preferredFirstName: null, salonIds: ["loc-0309"] });
const ROSTER = [
  person("e-1", "Mireya", "Vantrell"),
  person("e-2", "Caspian", "Drummet"),
  person("e-3", "Odalys", "Frewen"),
  person("e-4", "Perrin", "Haldane"),
];

const turn = (id: string, role: "user" | "assistant", content: string) => ({ id, role, content }) as ChatMessage;

const SAME = "Can you do the same thing for Caspian Drummet but switch it to a written";
const ALSO = "also make a coaching form for Caspian Drummet";
const MIREYA = "I need a verbal corrective action for Mireya Vantrell, she was late opening the salon on Monday";

afterEach(() => {
  delete process.env.SAME_REQUEST_OTHER_PERSON_ENABLED;
});

describe("the turn's shape", () => {
  it("reads the reported wordings, and never an account of what happened", () => {
    expect(sameRequestKind(SAME)).toBe("same");
    expect(sameRequestKind("Can you do the same thing for Perrin Haldane but switch it to a written")).toBe("same");
    expect(sameRequestKind(ALSO)).toBe("also");
    expect(switchedLevel(SAME)).toBe("written");
    expect(sameRequestKind("She did the same thing for Caspian yesterday")).toBeNull();
    expect(sameRequestKind("change this to a coaching form")).toBeNull();
    expect(asksForAnotherPerson("also make a coaching form for her")).toBe(false);
    expect(asksForAnotherPerson(ALSO)).toBe(true);
  });

  it("with the flag on, \"also make a coaching form for <B>\" is no switch of <A>'s card to coaching", () => {
    expect(requestedForm(ALSO)).toBe("coaching");
    process.env.SAME_REQUEST_OTHER_PERSON_ENABLED = "true";
    expect(requestedForm(ALSO)).toBeNull();
    expect(requestedForm("change this to a coaching form")).toBe("coaching");
  });
});

describe("sameRequestForOtherPerson", () => {
  it("(a) \"do the same thing for <B> but switch it to a written\": <A>'s request with <B>'s name, Written", () => {
    const read = sameRequestForOtherPerson({
      question: SAME,
      history: [turn("m1", "user", MIREYA), turn("a1", "assistant", "I'll draft a **Corrective Action Form** for **Mireya Vantrell** …")],
      roster: ROSTER,
      continueTemplateKey: "dpoa",
    });
    expect(read?.question).toBe("I need a written corrective action for Caspian Drummet, she was late opening the salon on Monday");
    expect(read?.name).toBe("Caspian Drummet");
    expect(read?.historyBefore).toBe(0);
    expect(read?.sourceIds).toEqual(["m1"]);
  });

  it("sf-s11: the form asked for in a general turn, then \"<A>. Verbal Warning. Under Performance.\"", () => {
    const read = sameRequestForOtherPerson({
      question: "Can you do the same thing for Perrin Haldane but switch it to a written",
      history: [
        turn("m1", "user", "what information do you need for a corrective action for an employee"),
        turn("a1", "assistant", "A grounded answer."),
        turn("m2", "user", "Odalys Frewen. Verbal Warning. Under Performance."),
        turn("a2", "assistant", "Great, I can help you create a **Corrective Action Form**."),
      ],
      roster: ROSTER,
      formOpen: true,
    });
    expect(read?.question).toBe("I need a written corrective action for Perrin Haldane. Written Warning. Under Performance.");
    expect(read?.question).not.toMatch(/odalys|frewen/i);
    expect(read?.historyBefore).toBe(2);
  });

  it("(c) \"also make a coaching form for <B>\": a plain Coaching request for <B>, nothing of <A>'s account", () => {
    const read = sameRequestForOtherPerson({ question: ALSO, history: [turn("m1", "user", MIREYA)], roster: ROSTER, continueTemplateKey: "dpoa" });
    expect(read).toMatchObject({ kind: "also", question: "create a coaching form for Caspian Drummet", sourceIds: [] });
  });

  it("nothing when no card or form is open, the turn names the card's own person, or nobody on the roster", () => {
    const history = [turn("m1", "user", MIREYA)];
    expect(sameRequestForOtherPerson({ question: SAME, history, roster: ROSTER })).toBeNull();
    expect(sameRequestForOtherPerson({ question: "do the same thing for Mireya Vantrell", history, roster: ROSTER, continueTemplateKey: "dpoa" })).toBeNull();
    expect(sameRequestForOtherPerson({ question: "do the same thing for Zelda Nobody", history, roster: ROSTER, continueTemplateKey: "dpoa" })).toBeNull();
  });
});

describe("the card, Create and the draft", () => {
  it("<B>'s card says what it carries, and its draft is written from <A>'s turns", () => {
    const read = sameRequestForOtherPerson({ question: SAME, history: [turn("m1", "user", MIREYA)], roster: ROSTER, continueTemplateKey: "dpoa" })!;
    const answer = withSameRequestNote(
      { content: "Card.", citations: [], coverage: "not_applicable", recommendedVideoIds: [], formProposal: { employeeName: "Caspian Drummet", sourceMessageIds: ["m2"] } as never },
      read,
    );
    expect(answer.content).toMatch(/^A new card for \*\*Caspian Drummet\*\*, from your earlier request: "I need a written corrective action for Caspian Drummet, she was late opening/);
    expect(answer.content).not.toMatch(/mireya/i);
    expect(answer.formProposal?.sourceMessageIds).toEqual(["m1", "m2"]);
  });

  it("Create reads the conversation from the \"same thing\" turn on; the draft notes are <A>'s request with <B>'s name", () => {
    const conversation = [
      { role: "user", content: MIREYA },
      { role: "assistant", content: "card" },
      { role: "user", content: SAME },
    ];
    expect(sameRequestReadConversation(conversation)).toBe(conversation);
    expect(notesForOtherPerson({ notes: `${MIREYA}\n\n${SAME}`, employeeName: "Caspian Drummet", templateKey: "dpoa", roster: ROSTER })).toBe(`${MIREYA}\n\n${SAME}`);
    process.env.SAME_REQUEST_OTHER_PERSON_ENABLED = "true";
    expect(sameRequestReadConversation(conversation)).toEqual([{ role: "user", content: SAME }]);
    expect(notesForOtherPerson({ notes: `${MIREYA}\n\n${SAME}`, employeeName: "Caspian Drummet", templateKey: "dpoa", roster: ROSTER })).toBe(
      "I need a written corrective action for Caspian Drummet, she was late opening the salon on Monday",
    );
  });
});
