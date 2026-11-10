import { afterEach, describe, expect, it, vi } from "vitest";

import { withPressCreateReply } from "./card-meta-turn";

// QA's round-16b live test in the sibling app (10 Nov 2026): "Create a Coaching Form from this conversation." after a Coaching card.
const CARD = { content: "Here is what I would put on a **Coaching Form**.\n\n**Date:** 11/10/2026", formProposal: { templateKey: "coaching", templateName: "Coaching Form" } };
const ASKED = { question: "Create a Coaching Form from this conversation.", continueProposalTemplateKey: "coaching", activeFormInstanceId: undefined };
const on = (...flags: string[]) => flags.forEach((flag) => vi.stubEnv(flag, "true"));

describe("CREATE_REPLY_PLAIN_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: a named form is not read as a create command; the reply is as built", () => {
    on("CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED");
    expect(withPressCreateReply(CARD, ASKED)).toEqual(CARD);
  });

  it("on: naming the card's own form points to it, in one plain line, the card attached", () => {
    on("CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED", "CREATE_REPLY_PLAIN_ENABLED");
    const out = withPressCreateReply(CARD, ASKED);
    expect(out.content).toBe("The **Coaching Form** card above is ready — press **Create draft** on it to make the draft. Nothing is saved to anyone's file until you press it.");
    expect(out.formProposal).toBe(CARD.formProposal);
  });

  it("on: another form named stays a request; the generic wording gets the plain line too", () => {
    on("CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED", "CREATE_REPLY_PLAIN_ENABLED");
    expect(withPressCreateReply(CARD, { ...ASKED, question: "Create a CA from this conversation." })).toEqual(CARD);
    expect(withPressCreateReply(CARD, { ...ASKED, question: "Create a form from this conversation." }).content).toMatch(/^The \*\*Coaching Form\*\* card above is ready/);
  });
});
