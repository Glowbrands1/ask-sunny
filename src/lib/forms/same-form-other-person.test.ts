import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AskRequest } from "@/lib/ai/types";

import { JOIN } from "./bounded-context";
import type { RosterEmployee } from "./employee-match";
import {
  readSameFormOtherPerson,
  sameFormOtherPersonNotes,
  sameFormReadConversation,
  withSameFormOtherPerson,
  withSameFormSources,
} from "./same-form-other-person";

/**
 * SAME_FORM_OTHER_PERSON_ENABLED. QA's overnight scan sf-s11 (4 Nov 2026) and
 * coding3 (a) (5 Nov 2026): "Can you do the same thing for <B> but switch it
 * to a written" with <A>'s card on screen or created. The manager's words are
 * verbatim; the people are invented. Replay cases:
 * `nov5-coding3-sfo-a-same-thing-card-on-screen`, `nov4-scan-sf-s11-same-for-another`.
 */

const saved = process.env.SAME_FORM_OTHER_PERSON_ENABLED;
beforeEach(() => {
  process.env.SAME_FORM_OTHER_PERSON_ENABLED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SAME_FORM_OTHER_PERSON_ENABLED;
  else process.env.SAME_FORM_OTHER_PERSON_ENABLED = saved;
});

const ROSTER: RosterEmployee[] = [
  { id: "e-mireya", firstName: "Mireya", lastName: "Vantrell", preferredFirstName: "Mimi", salonIds: ["loc-0309"] },
  { id: "e-caspian", firstName: "Caspian", lastName: "Drummet", preferredFirstName: null, salonIds: ["loc-0309"] },
  { id: "e-liora", firstName: "Liora", lastName: "Pellow", preferredFirstName: null, salonIds: ["loc-0309"] },
];

const OPENING = "I need a verbal corrective action for Mireya Vantrell, she was late opening the salon on Monday";
const SAME = "Can you do the same thing for Caspian Drummet but switch it to a written";

function cardOpen(question: string): AskRequest {
  return {
    question,
    questionMessageId: "u2",
    continueProposalTemplateKey: "dpoa",
    history: [
      { id: "u1", role: "user", content: OPENING, createdAt: "2026-11-05T15:00:00Z" },
      { id: "a1", role: "assistant", content: "Here is the Corrective Action card.", createdAt: "2026-11-05T15:00:01Z" },
    ],
  } as unknown as AskRequest;
}

describe("readSameFormOtherPerson", () => {
  it("the manager's words: B, and the level the turn states", () => {
    expect(readSameFormOtherPerson({ question: SAME, employeeName: "Mireya Vantrell", people: ROSTER })).toEqual({
      from: "Mireya Vantrell",
      to: "Caspian Drummet",
      level: "written",
    });
  });

  it("an account that mentions a coworker is never a request for the coworker", () => {
    for (const turn of ["Mireya Vantrell was rude to Caspian Drummet", "she yelled at Caspian Drummet in front of guests", "she was rude to Caspian Drummet when he reminded her", "Caspian Drummet saw it too"]) {
      expect(readSameFormOtherPerson({ question: turn, employeeName: "Mireya Vantrell", people: ROSTER }), turn).toBeNull();
    }
  });

  it("a turn that names a form of its own goes where it always went", () => {
    expect(readSameFormOtherPerson({ question: "also make a coaching form for Caspian Drummet", employeeName: "Mireya Vantrell", people: ROSTER })).toBeNull();
  });

  it("A's own name, two other people, or nobody: not this", () => {
    expect(readSameFormOtherPerson({ question: "Can you do the same thing for Mireya but switch it to a written", employeeName: "Mireya Vantrell", people: ROSTER })).toBeNull();
    expect(readSameFormOtherPerson({ question: "Can you do the same thing for Mimi but switch it to a written", employeeName: "Mireya Vantrell", people: ROSTER })).toBeNull();
    expect(readSameFormOtherPerson({ question: "Can you do the same thing for Caspian Drummet and Liora Pellow", employeeName: "Mireya Vantrell", people: ROSTER })).toBeNull();
    expect(readSameFormOtherPerson({ question: "switch it to a written", employeeName: "Mireya Vantrell", people: ROSTER })).toBeNull();
  });

  it("off: never", () => {
    delete process.env.SAME_FORM_OTHER_PERSON_ENABLED;
    expect(readSameFormOtherPerson({ question: SAME, employeeName: "Mireya Vantrell", people: ROSTER })).toBeNull();
  });
});

describe("withSameFormOtherPerson, A's card on screen", () => {
  it("B's request is A's request turns with B's name; the card is not continued", () => {
    const read = withSameFormOtherPerson(cardOpen(SAME), ROSTER);
    expect(read.question).toBe("I need a verbal corrective action for Caspian Drummet, she was late opening the salon on Monday");
    expect(read.continueProposalTemplateKey).toBeUndefined();
    expect(read.sameFormFor).toEqual({ sourceMessageIds: ["u1"], level: "written" });
  });

  it("an account about a coworker stays A's turn", () => {
    const request = cardOpen("Mireya Vantrell was rude to Caspian Drummet");
    expect(withSameFormOtherPerson(request, ROSTER)).toBe(request);
  });

  it("B's card takes this turn's level and A's turns and this turn as its draft sources", () => {
    const read = withSameFormOtherPerson(cardOpen(SAME), ROSTER);
    const card = { templateKey: "dpoa", employeeName: "Caspian Drummet", warningLevel: "verbal", sourceMessageIds: ["u2"] };
    const out = withSameFormSources({ content: "", citations: [], formProposal: card } as never, read);
    expect(out.formProposal).toMatchObject({ warningLevel: "written", sourceMessageIds: ["u1", "u2"] });
  });
});

describe("Create", () => {
  it("the conversation is read as the chat read it: B's request, A's turns not a second person", () => {
    const turns = [
      { role: "user", content: OPENING },
      { role: "assistant", content: "Here is the Corrective Action card." },
      { role: "user", content: SAME },
    ];
    expect(sameFormReadConversation(turns, ROSTER).map((turn) => turn.content)).toEqual([
      "Here is the Corrective Action card.",
      "I need a verbal corrective action for Caspian Drummet, she was late opening the salon on Monday",
    ]);
  });

  it("the draft notes are A's turns with B's name, the manager's own words only: never the request sentence, never a level sentence", () => {
    const notes = [OPENING, SAME].join(JOIN);
    const read = sameFormOtherPersonNotes(notes, "Caspian Drummet", ROSTER);
    expect(read).toBe("I need a verbal corrective action for Caspian Drummet, she was late opening the salon on Monday");
    expect(read).not.toMatch(/written warning/i);
  });

  it("notes for A's own form, or an account, are read as sent", () => {
    expect(sameFormOtherPersonNotes([OPENING, "she was also late on Tuesday"].join(JOIN), "Mireya Vantrell", ROSTER)).toBeNull();
    expect(sameFormOtherPersonNotes([OPENING, "Mireya Vantrell was rude to Caspian Drummet"].join(JOIN), "Mireya Vantrell", ROSTER)).toBeNull();
  });
});
