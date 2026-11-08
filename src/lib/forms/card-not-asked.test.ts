import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AskResponse } from "@/lib/ai/types";

import { withoutWhichAskOnSeatedCard } from "./card-not-asked";

/**
 * TWO_FORMS_CARD_NOT_ASKED_ENABLED (QA, 8 Nov 2026, conv ef902fec). The live reply, word for word, to the tester's
 * "Coaching form for Dana Lane. Also a CA for Marnie Quill." (the tester's own invented names, on neither app's
 * directory), with the card it carried: the Coaching Form for Dana Lane, status ready.
 */
const LIVE =
  "Here is what I would put on a **Coaching Form**.\n\nWhich of them is this **Coaching Form** for — **Dana Lane** or **Marnie Quill**?\n\n**Do you want a Corrective Action Form for Marnie Quill next?** Say **yes** and I'll start it.";

const reply = (content: string, card: Record<string, unknown> | null): AskResponse =>
  ({ content, citations: [], formProposal: card ?? undefined }) as unknown as AskResponse;
const coaching = (employeeName: string | null, status = "ready") => ({ templateName: "Coaching Form", templateKey: "coaching", employeeName, status });

describe("TWO_FORMS_CARD_NOT_ASKED_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off (as before): the live reply is unchanged", () => {
    const live = reply(LIVE, coaching("Dana Lane"));
    expect(withoutWhichAskOnSeatedCard(live)).toBe(live);
  });

  describe("on", () => {
    beforeEach(() => vi.stubEnv("TWO_FORMS_CARD_NOT_ASKED_ENABLED", "true"));

    it("the live reply: the card for Dana Lane is not asked which, and B's offer stays", () => {
      const out = withoutWhichAskOnSeatedCard(reply(LIVE, coaching("Dana Lane")));
      expect(out.content).toBe(
        "Here is what I would put on a **Coaching Form**.\n\n**Do you want a Corrective Action Form for Marnie Quill next?** Say **yes** and I'll start it.",
      );
      expect(out.formProposal).toMatchObject({ employeeName: "Dana Lane", status: "ready" });
    });

    it("with the ask's own tail, and the card waiting for its salon: still left out", () => {
      const asked = LIVE.replace("**Marnie Quill**?", "**Marnie Quill**? Tell me and I'll draft it from what you've already described.");
      expect(withoutWhichAskOnSeatedCard(reply(asked, coaching("Dana Lane", "needs_location"))).content).not.toMatch(/Which of them/);
    });

    it("unchanged: no employee on the card, a card waiting for its employee, a choice without the card's employee, another form, no card", () => {
      for (const card of [coaching(null), coaching("Dana Lane", "needs_employee")]) {
        const answer = reply(LIVE, card);
        expect(withoutWhichAskOnSeatedCard(answer)).toBe(answer);
      }
      const others = reply(LIVE.replace("**Dana Lane** or", "**Dana Laine** or"), coaching("Dana Lane"));
      expect(withoutWhichAskOnSeatedCard(others)).toBe(others);
      const otherForm = reply(LIVE.replace("this **Coaching Form** for", "this **Corrective Action Form** for"), coaching("Dana Lane"));
      expect(withoutWhichAskOnSeatedCard(otherForm)).toBe(otherForm);
      const noCard = reply(LIVE, null);
      expect(withoutWhichAskOnSeatedCard(noCard)).toBe(noCard);
    });
  });
});
