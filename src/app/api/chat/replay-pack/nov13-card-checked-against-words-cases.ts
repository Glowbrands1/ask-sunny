import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE CARD, CHECKED AGAINST THE MANAGER'S WORDS (CARD_CHECKED_AGAINST_WORDS_ENABLED; Pau's direction via QA, 13 Nov 2026)
 * ============================================================================
 *
 * Ported from the sibling app. One general check on every card before it is shown
 * (`forms/card-checked-against-words.ts`). This app's cards carry no Issue (the sibling's live failures were all in its
 * Issue line), so here the check reads the person: a job title or a salon is never the person on the card. The guard:
 * a card that is already right is shown exactly as built, with no model call. The person is invented.
 */

export const NOV13_CARD_CHECKED_AGAINST_WORDS_CASES: ReplayCase[] = [
  {
    id: "nov13-card-checked-right-card-unchanged",
    title: "\"create a CA for Marnie Holloway, she was late on 11/3/26\": a card that is already right is shown as built, with no model call",
    report: "Pau's direction via QA, 13 Nov 2026: check the card against the manager's own words before showing it (guard)",
    status: "fixed",
    fixFlags: ["CARD_CHECKED_AGAINST_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a CA for Marnie Holloway, she was late on 11/3/26");
      expect(thread.proposal, reply.content).toMatchObject({ employeeName: "Marnie Holloway", status: "ready" });
      expect(reply.content).not.toMatch(/Who is this card for\?|What happened\?/);
      expect(t.cardCheckCalls?.() ?? 0).toBe(0);
    },
  },
];
