import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { withNewFormOwnTurn } from "./new-form-own-turn";
import type { AskRequest, AskResponse } from "./types";

/**
 * QA live run, 26 Oct 2026 (S20, conv_mvomozjati6imk): a second coaching form
 * for the same employee was drafted with both turns' text. The tester's
 * wording; the name is invented.
 */
const FLAG = "NEW_FORM_OWN_TURN_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const CARD = { templateKey: "coaching", templateName: "Coaching Form", employeeName: "Rory Vance" } as unknown as ChatFormProposal;
const HISTORY = [
  { id: "m1", role: "user", content: "coaching form for rory vance, late today" },
  { id: "m2", role: "assistant", content: "Here is what I would put on a **Coaching Form**.", formProposal: CARD },
];

function second(question: string, ids: string[] = ["m1", "m3"]): AskResponse {
  const response = { content: "x", citations: [], formProposal: { ...CARD, sourceMessageIds: ids } } as unknown as AskResponse;
  return withNewFormOwnTurn(response, { question, history: HISTORY } as unknown as AskRequest);
}

describe("NEW_FORM_OWN_TURN_ENABLED off", () => {
  it("keeps the earlier request's turn, as on main", () => {
    delete process.env[FLAG];
    expect(second("another coaching form for rory vance, she left early yesterday").formProposal?.sourceMessageIds).toEqual(["m1", "m3"]);
  });
});

describe("NEW_FORM_OWN_TURN_ENABLED on", () => {
  it.each([
    "another coaching form for rory vance, she left early yesterday",
    "Another coaching form for Rory Vance, she left early yesterday",
    "ANOTHER COACHING FORM FOR RORY VANCE, SHE LEFT EARLY YESTERDAY",
    "can you make a new coaching form for rory vance, she left early yesterday",
    "one more ca for rory vance, she left early yesterday",
  ])("'%s' is drafted from its own turn only", (question) => {
    process.env[FLAG] = "on";
    expect(second(question).formProposal?.sourceMessageIds).toEqual(["m3"]);
  });

  it.each(["she left early yesterday too", "add that she left early yesterday", "use today's date"])("'%s' adds to the same form", (question) => {
    process.env[FLAG] = "on";
    expect(second(question).formProposal?.sourceMessageIds).toEqual(["m1", "m3"]);
  });

  it("with no card before it, the turn is as it is", () => {
    process.env[FLAG] = "on";
    const response = { content: "x", citations: [], formProposal: { ...CARD, sourceMessageIds: ["m1"] } } as unknown as AskResponse;
    expect(withNewFormOwnTurn(response, { question: "another coaching form for rory vance", history: [HISTORY[0]] } as unknown as AskRequest)).toBe(response);
  });
});

/** QA-7 probes, 26 Oct 2026: a negated, edited or excepted "new form" keeps the earlier turns. */
describe("NEW_FORM_OWN_TURN_ENABLED on: only a request for another form", () => {
  const sentence = (text: string) => text[0]!.toUpperCase() + text.slice(1);

  it.each([
    "not another coaching form for rory vance",
    "don't make another coaching form",
    "do not create a new coaching form, just add that she left early",
    "no new form, she also left early",
    "never make a second ca for rory",
    "without another form, add that she left early yesterday",
    "make another form for anyone except rory vance",
    "change it to the new date for the coaching form",
    "the new hire rory vance left early, add it to the form",
    "use the next open date for the coaching form",
    "separate the two dates on the form",
    "redraft the coaching form with the new date 10/4",
    "edit the form, she left early on the next day",
  ])("'%s' keeps the earlier turns, in lowercase and sentence case", (question) => {
    process.env[FLAG] = "on";
    for (const variant of [question, sentence(question)]) expect(second(variant).formProposal?.sourceMessageIds).toEqual(["m1", "m3"]);
  });

  it.each(["a second ca for rory vance, she left early", "make another coaching form for rory vance", "Create a new coaching form for Rory Vance"])("'%s' is its own form", (question) => {
    process.env[FLAG] = "on";
    expect(second(question).formProposal?.sourceMessageIds).toEqual(["m3"]);
  });
});
