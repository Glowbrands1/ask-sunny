import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RosterEmployee } from "@/lib/forms/employee-match";

import { forAnotherPerson, switchReadConversation, withFormTypeSwitch, withSwitchAfterCreate } from "./form-type-switch";
import type { AskRequest } from "./types";

/**
 * SWITCH_NOT_FOR_ANOTHER_PERSON_ENABLED (QA, 5 Nov 2026). With <A>'s
 * Corrective Action card open, "also make a coaching form for <B>" gave a
 * Coaching card for <A>. The managers' words are verbatim; the people are
 * invented. Replay cases: `nov5-coding3-sfo-c-also-coaching-card-open` and
 * `nov5-coding3-sfo-c-also-coaching-after-create`.
 */

const FLAGS = ["SWITCH_NOT_FOR_ANOTHER_PERSON_ENABLED", "FORM_TYPE_SWITCH_ENABLED", "FORM_TYPE_SWITCH_AFTER_CREATE_NOTE_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const name of FLAGS) saved[name] = process.env[name];
  process.env.FORM_TYPE_SWITCH_ENABLED = "true";
  process.env.FORM_TYPE_SWITCH_AFTER_CREATE_NOTE_ENABLED = "true";
  process.env.SWITCH_NOT_FOR_ANOTHER_PERSON_ENABLED = "true";
});
afterEach(() => {
  for (const name of FLAGS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const ROSTER: RosterEmployee[] = [
  { id: "e-mireya", firstName: "Mireya", lastName: "Vantrell", preferredFirstName: "Mimi", salonIds: ["loc-0309"] },
  { id: "e-caspian", firstName: "Caspian", lastName: "Drummet", preferredFirstName: null, salonIds: ["loc-0309"] },
];

const OPENING = "I need a corrective action for Mireya Vantrell, she was late opening the salon on Monday";
const ALSO = "also make a coaching form for Caspian Drummet";

function cardOpen(question: string): AskRequest {
  return {
    question,
    continueProposalTemplateKey: "dpoa",
    history: [
      { id: "u1", role: "user", content: OPENING, createdAt: "2026-11-05T15:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        content: "Here is the Corrective Action card.",
        createdAt: "2026-11-05T15:00:01Z",
        formProposal: { templateKey: "dpoa", employeeName: "Mireya Vantrell" },
      },
    ],
  } as unknown as AskRequest;
}

describe("forAnotherPerson", () => {
  it("B's name on A's card is another person", () => {
    expect(forAnotherPerson(ALSO, "Mireya Vantrell", ROSTER)).toBe(true);
    expect(forAnotherPerson("also make a coaching form for Caspian", "Mireya Vantrell", ROSTER)).toBe(true);
  });

  it("A's full name, first name or preferred name is A", () => {
    expect(forAnotherPerson("make it a coaching for Mireya Vantrell", "Mireya Vantrell", ROSTER)).toBe(false);
    expect(forAnotherPerson("make it a coaching for Mireya", "Mireya Vantrell", ROSTER)).toBe(false);
    expect(forAnotherPerson("make it a coaching for Mimi", "Mireya Vantrell", ROSTER)).toBe(false);
  });

  it("no name is nobody else", () => {
    expect(forAnotherPerson("make it a coaching", "Mireya Vantrell", ROSTER)).toBe(false);
    expect(forAnotherPerson("change to coaching", "Mireya Vantrell", ROSTER)).toBe(false);
  });

  it("off: never", () => {
    delete process.env.SWITCH_NOT_FOR_ANOTHER_PERSON_ENABLED;
    expect(forAnotherPerson(ALSO, "Mireya Vantrell", ROSTER)).toBe(false);
  });
});

describe("withFormTypeSwitch, A's card open", () => {
  it('"make it a coaching" with no name still switches', () => {
    expect(withFormTypeSwitch(cardOpen("make it a coaching"), ROSTER).question).toBe("change this to a coaching form");
  });

  it("A's first name still switches", () => {
    expect(withFormTypeSwitch(cardOpen("make it a coaching for Mireya"), ROSTER).question).toBe("change this to a coaching form");
  });

  it("B's name is read as typed, and A's request is not rewritten", () => {
    const read = withFormTypeSwitch(cardOpen(ALSO), ROSTER);
    expect(read.question).toBe(ALSO);
    expect(read.history[0]!.content).toBe(OPENING);
  });

  it("off: B's name switches A's card, as before", () => {
    delete process.env.SWITCH_NOT_FOR_ANOTHER_PERSON_ENABLED;
    expect(withFormTypeSwitch(cardOpen(ALSO), ROSTER).question).toBe("change this to a coaching form");
  });
});

describe("withSwitchAfterCreate, A's form created and open", () => {
  const open = (question: string) => ({ ...cardOpen(question), activeFormInstanceId: "11111111-1111-1111-1111-111111111111" }) as AskRequest;

  it('"make it a coaching" with no name still starts A\'s Coaching card', () => {
    expect(withSwitchAfterCreate(open("make it a coaching"), "Mireya Vantrell", ROSTER).question).toMatch(/coaching form for Mireya Vantrell/);
  });

  it("B's name is B's request, read as typed", () => {
    const read = withSwitchAfterCreate(open(ALSO), "Mireya Vantrell", ROSTER);
    expect(read.question).toBe(ALSO);
    expect(read.switchedFromForm).toBeUndefined();
  });
});

describe("switchReadConversation (Create)", () => {
  const turns = (question: string) => [
    { role: "user", content: OPENING },
    { role: "assistant", content: "Here is the Corrective Action card." },
    { role: "user", content: question },
    { role: "assistant", content: "Here is the Coaching card." },
  ];

  it("B's request stays as typed, A's request is not rewritten", () => {
    expect(switchReadConversation(turns(ALSO), ROSTER).map((turn) => turn.content)).toEqual(turns(ALSO).map((turn) => turn.content));
  });

  it("a switch with A's first name is still read as the switch", () => {
    expect(switchReadConversation(turns("make it a coaching for Mireya"), ROSTER)[2]!.content).toBe("change this to a coaching form");
  });
});
