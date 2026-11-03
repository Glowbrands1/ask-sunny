import { expect } from "vitest";

import { cardPolicyHeading } from "@/lib/forms/card-policy";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/** QA's live check, 3 Nov 2026: the card and the draft made from it cited different policies. */
export const NOV3_CARD_POLICY_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-draft-cites-card-policy",
    title: "the draft cites the policy its card cited",
    report: 'the card for "make me a CA for <name> for being late to opening this morning" read "Policy: Late Opening p.15"; the draft made from it, Attendance p.14 (QA live check)',
    // Fixed in production: the flag on (QA, 3 Nov 2026).
    status: "fixed",
    fixFlags: ["NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const card = await thread.say("make me a CA for Remy Calder for being late to opening this morning");
      const cited = cardPolicyHeading(card.content);
      expect(cited, "the card cites no policy").toBeTruthy();
      t.draftWrites({ observation: "Remy was late to opening this morning." });
      const id = await thread.create();
      const violated = t.values(id).policy_violated ?? "";
      expect(violated.toLowerCase()).toContain(cited!.toLowerCase());
    },
  },
];
