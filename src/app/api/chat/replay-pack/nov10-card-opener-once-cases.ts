import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A FORM CHAT SAYS ITS LONG OPENER ONCE (QA's October triage, 10 Nov 2026; the sibling's #200)
 * ============================================================================
 *
 * On main with production's flags, every turn of a Corrective Action chain repeated "I'll draft a **Corrective Action
 * Form** for **<employee>** from what you've described, and check the applicable company policy …" and the "nothing is
 * saved to anyone's file until you do" line. Fixed with HUMAN_REPLIES_ENABLED (`ai/human-replies.ts`).
 */
const NAME = "Remy Calder";
const OPENER = /from what you've described, and check the applicable company policy/;

export const NOV10_CARD_OPENER_ONCE_CASES: ReplayCase[] = [
  {
    id: "nov10-card-opener-once-ca-chain",
    title: "a CA chain: the second turn does not repeat the opener, and the card is the same employee's",
    report: "QA's October triage (10 Nov 2026) of the sibling's #200; the same here on main with production's flags",
    status: { open: "every turn repeats the full opener; fixed with HUMAN_REPLIES_ENABLED" },
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
      expect(second.content, second.content).not.toMatch(/nothing is saved to anyone's file until you do/);
    },
  },
];
