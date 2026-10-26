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
