import { afterEach, describe, expect, it, vi } from "vitest";

import { PRESS_CREATE, WHAT_IS_OUT_OF_DATE, WHAT_IS_WRONG, cardMetaTurn, withoutCardMetaTurns } from "./card-meta-turn";
import type { AskResponse } from "./types";

/** QA's sf-s38, 8 Nov 2026: CREATE_COMMAND_POINTS_TO_CARD_ENABLED and CARD_COMPLAINT_NOT_ACCOUNT_ENABLED. Invented person. */
const T1 = "make me an CA for Rowan Kestrel missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";
const history = [
  { id: "m1", role: "user", content: T1 },
  { id: "a1", role: "assistant", content: "I'll draft a **Corrective Action Form** for **Rowan Kestrel** …" },
] as never;
const onCard = (question: string) => ({ question, history, continueProposalTemplateKey: "dpoa", questionMessageId: "m9" });

afterEach(() => {
  vi.unstubAllEnvs();
});

function bothOn() {
  vi.stubEnv("CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "true");
  vi.stubEnv("CARD_COMPLAINT_NOT_ACCOUNT_ENABLED", "true");
}

describe("cardMetaTurn", () => {
  it("off: null", () => {
    expect(cardMetaTurn(onCard("create it"))).toBeNull();
    expect(cardMetaTurn(onCard("this proposal is out od fate"))).toBeNull();
  });

  it.each(["create it", "create  the draft", "please create the form", "go ahead and create it", "ok create it", "can you create it?"])(
    "%s → press Create draft, from T1",
    (question) => {
      bothOn();
      const turn = cardMetaTurn(onCard(question));
      expect(turn?.from).toBe(T1);
      const again = { content: "card", citations: [], formProposal: { templateKey: "dpoa", sourceMessageIds: ["m9"] } } as unknown as AskResponse;
      const reply = turn!.answer(again);
      expect(reply.content).toBe(PRESS_CREATE);
      expect(reply.formProposal?.sourceMessageIds).toEqual(["m1"]);
    },
  );

  it.each([
    ["this proposal is out od fate", WHAT_IS_OUT_OF_DATE],
    ["this proposal is out of date", WHAT_IS_OUT_OF_DATE],
    ["the card looks outdated", WHAT_IS_OUT_OF_DATE],
    ["this form is wrong", WHAT_IS_WRONG],
    ["the proposal is not right", WHAT_IS_WRONG],
  ])("%s → asks what to change", (question, line) => {
    bothOn();
    const turn = cardMetaTurn(onCard(question));
    expect(turn?.answer({ content: "card", citations: [], formProposal: { templateKey: "dpoa", sourceMessageIds: [] } } as unknown as AskResponse).content).toBe(line);
  });

  it.each([
    "create a coaching form for Rowan Kestrel",
    "she was also late on 11/2",
    "this proposal is out of date because she called in on sunday",
    "is this proposal out of date?",
    "the policy is wrong, it should be attendance",
  ])("%s → not about the card itself: null", (question) => {
    bothOn();
    expect(cardMetaTurn(onCard(question))).toBeNull();
  });

  it("a draft open, or no card: null", () => {
    bothOn();
    expect(cardMetaTurn({ ...onCard("create it"), activeFormInstanceId: "f-1" })).toBeNull();
    expect(cardMetaTurn({ ...onCard("create it"), continueProposalTemplateKey: undefined })).toBeNull();
  });

  it("each flag alone: only its own kind", () => {
    vi.stubEnv("CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "true");
    expect(cardMetaTurn(onCard("create it"))).not.toBeNull();
    expect(cardMetaTurn(onCard("this proposal is out od fate"))).toBeNull();
  });
});

describe("withoutCardMetaTurns (Create's notes)", () => {
  it("off: unchanged", () => {
    expect(withoutCardMetaTurns(`${T1}\n\nthis proposal is out od fate`)).toBe(`${T1}\n\nthis proposal is out od fate`);
  });
  it("on: the meta turns are no account", () => {
    bothOn();
    expect(withoutCardMetaTurns(`${T1}\n\ncreate it\n\nthis proposal is out od fate`)).toBe(T1);
  });
});

describe("CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED (QA's P6, Sunny live, 10 Nov 2026)", () => {
  const P6 = "Create a form from this conversation.";

  it("off: P6's wording is not a create command (the card's reply again)", () => {
    bothOn();
    expect(cardMetaTurn(onCard(P6))).toBeNull();
  });

  it.each([P6, "create a form from our chat", "make a new draft from this conversation", "please create the form based on this", "create the draft with this information", "ok, make a form from what we discussed"])(
    "on: %s → press Create draft, from T1",
    (question) => {
      bothOn();
      vi.stubEnv("CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED", "true");
      const turn = cardMetaTurn(onCard(question));
      expect(turn?.from).toBe(T1);
      const again = { content: "card", citations: [], formProposal: { templateKey: "dpoa", sourceMessageIds: ["m9"] } } as unknown as AskResponse;
      expect(turn!.answer(again).content).toBe(PRESS_CREATE);
      expect(withoutCardMetaTurns(`${T1}\n${question}`)).toBe(T1);
    },
  );

  it("on: a named form, or a request with an account, is still a request", () => {
    bothOn();
    vi.stubEnv("CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED", "true");
    for (const question of ["create a coaching form from this conversation", "create a form for Rowan Kestrel", "make a form from this conversation for being late on 11/2"]) {
      expect(cardMetaTurn(onCard(question)), question).toBeNull();
    }
  });
});

/**
 * CREATE_POINTS_TO_SHOWN_CARD_ENABLED — QA's #745 follow-up (12 Nov 2026; ported from the sibling app's #842): "write
 * ca", then "create it" said "press **Create draft** on the card" while the card only asked who it is for (no button).
 */
describe("CREATE_POINTS_TO_SHOWN_CARD_ENABLED", () => {
  const asksWho = { templateKey: "dpoa", employeeName: null, status: "needs_employee", supportsInlineDraft: false };
  const ready = { templateKey: "dpoa", employeeName: "Rowan Kestrel", status: "ready", supportsInlineDraft: true };
  const turn = (formProposal: object) => ({
    question: "create it",
    history: [
      { id: "m1", role: "user", content: "write ca" },
      { id: "a1", role: "assistant", content: "Who is this for?", formProposal },
    ] as never,
    continueProposalTemplateKey: "dpoa",
    questionMessageId: "m9",
  });

  it("off: the line is said with a who-is-it-for card (as before)", () => {
    vi.stubEnv("CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "true");
    expect(cardMetaTurn(turn(asksWho))?.card?.content).toBe(PRESS_CREATE);
  });

  it("on: no line pointing to a Create button the card does not show; a ready card keeps it", () => {
    vi.stubEnv("CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "true");
    vi.stubEnv("CREATE_POINTS_TO_SHOWN_CARD_ENABLED", "true");
    expect(cardMetaTurn(turn(asksWho))).toBeNull();
    expect(cardMetaTurn(turn(ready))?.card?.content).toBe(PRESS_CREATE);
  });
});
