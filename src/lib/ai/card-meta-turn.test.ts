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
