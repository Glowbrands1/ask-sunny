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

  it("sf-s20: \"Now make one for LYsandra\" — a request for the lone first name as typed, one roster person's", () => {
    const roster = [...ROSTER, person("e-5", "Jovelle", "Kerrigan"), person("e-6", "Lysandra", "Quade")];
    const read = sameRequestForOtherPerson({
      question: "Now make one for LYsandra",
      history: [turn("m1", "user", "create a coaching document for Jovelle Kerrigan"), turn("a1", "assistant", "Here is what I would put on a **Coaching Form**.")],
      roster,
      continueTemplateKey: "coaching",
    });
    expect(read).toMatchObject({ kind: "also", question: "create a coaching form for LYsandra" });
    expect(sameRequestForOtherPerson({ question: "Now make one for Jovelle", history: [turn("m1", "user", "create a coaching document for Jovelle Kerrigan")], roster, continueTemplateKey: "coaching" })).toBeNull();
  });

  it("QA's B21-4 \"now one for <B> for being late on 10-20-26\": <B>'s own request, from <B>'s turn only", () => {
    const roster = [...ROSTER, person("e-7", "Test", "Employee"), person("e-8", "Test", "Employee Two")];
    const read = sameRequestForOtherPerson({
      question: "NOW ONE FOR TEST EMPLOYEE TWO AT LAWRENCE FOR BEING LATE ON 10-20-26",
      history: [turn("m1", "user", "I need a corrective action for Test Employee, she was late opening the salon on Monday")],
      roster,
      continueTemplateKey: "dpoa",
    });
    expect(read).toMatchObject({ kind: "own", name: "Test Employee Two", historyBefore: 0, sourceIds: [] });
    expect(read?.question).toBe("I need a corrective action for TEST EMPLOYEE TWO AT LAWRENCE FOR BEING LATE ON 10-20-26");
  });

  it("never the same-form copy's wording, a person ruled out, or a coworker in the account", () => {
    expect(sameRequestKind("Do the same coaching form for remy calder")).toBeNull();
    expect(sameRequestKind("can you create the same draft that we did with Liora Pellow by changing the name and position?")).toBeNull();
    expect(sameRequestKind("do not make one for Mara Quell, she was not late on 10-20-26")).toBeNull();
    expect(sameRequestKind("she was rude to Caspian Drummet when he reminded her")).toBeNull();
  });

  it("nothing when no card or form is open, the turn names the card's own person, or nobody on the roster", () => {
    const history = [turn("m1", "user", MIREYA)];
    expect(sameRequestForOtherPerson({ question: SAME, history, roster: ROSTER })).toBeNull();
    expect(sameRequestForOtherPerson({ question: "do the same thing for Mireya Vantrell", history, roster: ROSTER, continueTemplateKey: "dpoa" })).toBeNull();
    // Off roster: no request with SAME_REQUEST_OFF_ROSTER_ENABLED off (production today). With it on, an off-roster <B> is
    // read as typed on purpose (QA's r23 live test; its own tests are below), so this line pins the flag off.
    process.env.SAME_REQUEST_OFF_ROSTER_ENABLED = "false";
    expect(sameRequestForOtherPerson({ question: "do the same thing for Zelda Nobody", history, roster: ROSTER, continueTemplateKey: "dpoa" })).toBeNull();
    delete process.env.SAME_REQUEST_OFF_ROSTER_ENABLED;
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

/*
 * SAME_REQUEST_OFF_ROSTER_ENABLED (QA's Sunny round-23 live test, conv_mwb1xng82tz2tyr, 10 Nov 2026): the live turns,
 * with <A> and <B> on no roster. The route hands the history as words only, so <A> is read from the card's reply.
 */
describe("SAME_REQUEST_OFF_ROSTER_ENABLED: <A> and <B> off the roster", () => {
  const SAME_THING = "Can you do the same thing for Mara Quell but make it a written";
  const history = [
    turn("u1", "user", "create a corrective action for Rory Vance, she was late on 11/3/26"),
    turn("a1", "assistant", "I'll draft a **Corrective Action Form** for **Rory Vance** from what you've described."),
  ];
  afterEach(() => {
    delete process.env.SAME_REQUEST_OFF_ROSTER_ENABLED;
  });

  it("off: as before, no same request", () => {
    process.env.SAME_REQUEST_OTHER_PERSON_ENABLED = "true";
    process.env.SAME_REQUEST_OFF_ROSTER_ENABLED = "false";
    expect(sameRequestForOtherPerson({ question: SAME_THING, history, roster: ROSTER, continueTemplateKey: "dpoa" })).toBeNull();
  });

  it("on: <B>'s request carries <A>'s account, with the written level", () => {
    process.env.SAME_REQUEST_OTHER_PERSON_ENABLED = "true";
    process.env.SAME_REQUEST_OFF_ROSTER_ENABLED = "true";
    const read = sameRequestForOtherPerson({ question: SAME_THING, history, roster: ROSTER, continueTemplateKey: "dpoa" });
    expect(read).toMatchObject({ kind: "same", name: "Mara Quell", from: "Rory Vance" });
    expect(read!.question).toMatch(/Mara Quell, she was late on 11\/3\/26/);
    expect(read!.question).toMatch(/Written Warning/);
  });

  it("on: <A> again, or a pronoun, is no other person", () => {
    process.env.SAME_REQUEST_OTHER_PERSON_ENABLED = "true";
    process.env.SAME_REQUEST_OFF_ROSTER_ENABLED = "true";
    expect(sameRequestForOtherPerson({ question: "Can you do the same thing for Rory Vance but make it a written", history, roster: ROSTER, continueTemplateKey: "dpoa" })).toBeNull();
    expect(sameRequestForOtherPerson({ question: "Can you do the same thing for her but make it a written", history, roster: ROSTER, continueTemplateKey: "dpoa" })).toBeNull();
  });
});
