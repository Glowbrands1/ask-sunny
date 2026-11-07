import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AskRequest } from "@/lib/ai/types";

import { proposalNameCorrection, withProposalNameCorrection } from "./proposal-name-correction";

/**
 * PROPOSAL_NAME_CORRECTION_ENABLED (QA, round 5, 8 Nov 2026; ported from Ask Bubbles, the 2 Nov 2026 chat there). The manager's words; the person is
 * invented (Odessa Lark Penhallow, typed "Penhallwo").
 */
const TYPED = "Odessa Lark Penhallwo";
const CARD = `I'll draft a **Corrective Action Form** for **${TYPED}** from what you've described, and check the applicable company policy before anything policy-related goes on it.`;

function request(question: string, overrides: Partial<AskRequest> = {}): AskRequest {
  return {
    question,
    mode: "standard",
    scopeId: "test",
    history: [
      { id: "u1", role: "user", content: "i have an employee, Odessa Lark Penhallwo that needs a corrective action form with a customer complaint" },
      { id: "a1", role: "assistant", content: CARD },
    ],
    ...overrides,
  } as AskRequest;
}

describe("PROPOSAL_NAME_CORRECTION_ENABLED", () => {
  beforeEach(() => vi.stubEnv("NAME_CORRECTION_WORDS_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("off (as before): the request is unchanged", () => {
    const asked = request("fix her last name penhallow");
    expect(withProposalNameCorrection(asked)).toBe(asked);
  });

  describe("on", () => {
    beforeEach(() => vi.stubEnv("PROPOSAL_NAME_CORRECTION_ENABLED", "true"));

    it("each wording becomes \"change her name to <the name>\" against the card's employee", () => {
      for (const [said, wanted] of [
        ["fix her last name penhallow", "change her name to Odessa Lark Penhallow"],
        ["under the employee line the name is supposed to be odessa lark penhallow", "change her name to Odessa Lark Penhallow"],
        ["okay the correct way is Odessa Lark Penhallow", "change her name to Odessa Lark Penhallow"],
        ["fix her last name, it is Penhallow", "change her name to Odessa Lark Penhallow"],
        ["her last name is Penhallow", "change her name to Odessa Lark Penhallow"],
        ["it's spelled Penhallow", "change her name to Odessa Lark Penhallow"],
        ["it's spelled Odessa Lark Penhallow", "change her name to Odessa Lark Penhallow"],
      ] as const) {
        expect(proposalNameCorrection(said, TYPED), said).toBe(wanted);
        expect(withProposalNameCorrection(request(said)).question, said).toBe(wanted);
      }
    });

    it("not a correction of her: another person's whole name, or any other turn", () => {
      for (const said of ["okay the correct way is Juno Paxton", "verbal warning, no payroll deduct", "she was rude to a guest on 11/2"]) {
        expect(withProposalNameCorrection(request(said)).question, said).toBe(said);
      }
    });

    it("only on a card not yet created: with a form open, or no card before this turn, the request is unchanged", () => {
      const open = request("fix her last name penhallow", { activeFormInstanceId: "00000000-0000-4000-8000-000000000001" });
      expect(withProposalNameCorrection(open)).toBe(open);
      const noCard = request("fix her last name penhallow", { history: [{ id: "a1", role: "assistant", content: "Here's the recipe." }] as AskRequest["history"] });
      expect(withProposalNameCorrection(noCard)).toBe(noCard);
    });
  });
});
