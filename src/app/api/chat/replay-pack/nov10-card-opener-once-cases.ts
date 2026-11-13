import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A FORM CHAT SAYS ITS LONG OPENER ONCE (QA's October triage, 10 Nov 2026; the sibling's #200)
 * ============================================================================
 *
 * On main with production's flags, every turn of a Corrective Action chain repeated "I'll draft a **Corrective Action
 * Form** for **<employee>** from what you've described, and check the applicable company policy …" Fixed with HUMAN_REPLIES_ENABLED (`ai/human-replies.ts`).
 */
const NAME = "Remy Calder";
const OPENER = /from what you've described, and check the applicable company policy/;

export const NOV10_CARD_OPENER_ONCE_CASES: ReplayCase[] = [
  {
    id: "nov10-card-opener-once-ca-chain",
    title: "a CA chain: the second turn does not repeat the opener, and the card is the same employee's",
    report: "QA's October triage (10 Nov 2026) of the sibling's #200; the same here on main with production's flags",
    // Changed on purpose (13 Nov 2026): fixed in production by HUMAN_REPLIES_ENABLED, QA round 38a. Was OPEN.
    status: "fixed",
    fixFlags: ["HUMAN_REPLIES_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const first = await thread.say(`create a ca for ${NAME}, she was late today`);
      expect(first.content, first.content).toMatch(OPENER);
      const second = await thread.say("verbal");
      expect(thread.proposal, second.content).toMatchObject({ templateKey: "dpoa", employeeName: NAME });
      expect(second.content, `the opener again:\n${second.content}`).not.toMatch(OPENER);
      // Changed on purpose (QA's ruling (b), 12 Nov 2026): only the opener goes. The card's Policy line and the full save
      // notice stay on every turn (the replay pack's multi-turn cases read them).
      const policyLine = (content: string) => content.split("\n").find((line) => /^\*\*Policy:\*\*/.test(line)) ?? null;
      expect(policyLine(second.content), `the Policy line left the card:\n${second.content}`).toBe(policyLine(first.content));
      expect(second.content, `the save notice left the card:\n${second.content}`).toMatch(/nothing is saved to anyone's file until you do/);
    },
  },
];
