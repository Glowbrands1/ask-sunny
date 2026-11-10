import { afterEach, describe, expect, it, vi } from "vitest";

import { asksWhatOutOfDateMeans, cardTurn, outOfDateAnswer } from "./out-of-date-is-the-proposal";
import type { AskRequest } from "./types";

/** OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED (QA round 5, sf-s38, 8 Nov 2026; the employee invented). */
const CARD = { proposalId: "p1", templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "Rhea Calloway" };
const OFFER = "I'll draft a **Corrective Action Form** for **Rhea Calloway** from what you've described.\n\nCreate the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.";
function asked(question: string, withCard = true): AskRequest {
  return {
    question,
    history: [
      { id: "u1", role: "user", content: "make me an CA for Rhea Calloway missing her saturday and sunday shifts", createdAt: "" },
      { id: "a1", role: "assistant", content: withCard ? OFFER : "That is in the attendance section of the policy manual.", createdAt: "" },
      { id: "u2", role: "user", content: "create it", createdAt: "" },
    ],
  } as unknown as AskRequest;
}

afterEach(() => vi.unstubAllEnvs());

describe("OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED", () => {
  it("off: never fires", () => {
    expect(asksWhatOutOfDateMeans(asked("what does out of date mean"))).toBe(false);
  });

  it.each(["what does out of date mean", "What does out of date mean?", "why is it out of date", "out of date?"])("on: %j is the card's question", (q) => {
    vi.stubEnv("OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED", "true");
    expect(asksWhatOutOfDateMeans(asked(q))).toBe(true);
  });

  it.each(["this proposal is out of date", "this proposal is out od fate", "the lotion is out of date"])(
    "on, negative: %j is a statement (coding 2's CARD_COMPLAINT_NOT_ACCOUNT reads complaints)",
    (q) => {
      vi.stubEnv("OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED", "true");
      expect(asksWhatOutOfDateMeans(asked(q))).toBe(false);
    },
  );

  it("on, negative: no card in the chat, no reading", () => {
    vi.stubEnv("OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED", "true");
    expect(asksWhatOutOfDateMeans(asked("what does out of date mean", false))).toBe(false);
  });

  it("the card is rebuilt from the manager's previous turn, over the history before it", () => {
    const turn = cardTurn(asked("what does out of date mean"))!;
    expect(turn.question).toBe("create it");
    expect(turn.questionMessageId).toBe("u2");
    expect(turn.history.map((entry) => entry.id)).toEqual(["u1", "a1"]);
  });

  it("asked twice in a row: the rebuilt turn skips the earlier out-of-date question (coding 2's review)", () => {
    const twice = asked("why is it out of date");
    twice.history.push({ id: "a2", role: "assistant", content: "\"Out of date\" means …", createdAt: "" } as never);
    twice.history.push({ id: "u3", role: "user", content: "what does out of date mean", createdAt: "" } as never);
    const turn = cardTurn(twice)!;
    expect(turn.question).toBe("create it");
    expect(turn.questionMessageId).toBe("u2");
  });

  it("no manager turn but out-of-date questions: no branch (it never answers itself)", () => {
    vi.stubEnv("OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED", "true");
    const only = {
      question: "what does out of date mean",
      history: [
        { id: "u1", role: "user", content: "what does out of date mean", createdAt: "" },
        { id: "a1", role: "assistant", content: OFFER, createdAt: "" },
      ],
    } as unknown as AskRequest;
    expect(cardTurn(only)).toBeNull();
    expect(asksWhatOutOfDateMeans(only)).toBe(false);
  });

  it("the answer names the card, asks which part, keeps the card, and cites nothing", () => {
    const reply = outOfDateAnswer({ content: OFFER, citations: [{ id: "S1" }] as never, recommendedVideoIds: [], formProposal: CARD as never });
    expect(reply.content).toContain("**Corrective Action Form** for **Rhea Calloway**");
    expect(reply.content).toContain("Which part of the proposal looks out of date?");
    expect(reply.content).not.toMatch(/\[\s*S\d/);
    expect(reply.formProposal).toMatchObject({ employeeName: "Rhea Calloway" });
    expect(reply.citations).toEqual([]);
  });
});
