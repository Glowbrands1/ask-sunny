import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/** QA's live check with NEXT_PUBLIC_CARD_POLICY_TO_DRAFT on, 3 Nov 2026 (10:08 UTC). */
export const NOV3_CARD_POLICY_LABEL_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-card-policy-label",
    title: "the Policy Violated line cites the section the card and the quote cite, not the box's own",
    report:
      'late opening: the card said "Late Opening Policy p.15", the draft quoted Late Opening, but Policy Violated read "Attendance Policy, JBA Policy Manual p.14" (QA live check)',
    status: { open: "CARD_POLICY_LABEL_ENABLED is off in production" },
    fixFlags: ["NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED", "CARD_POLICY_LABEL_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("make me a CA for Remy Calder for being late to opening this morning");
      // The live card's Policy line (the stand-in model reads this incident as Attendance).
      thread.cardReads("**Policy:** Late Opening Policy, JBA Policy Manual p.15");
      t.draftWrites({ observation: "Remy was late to opening this morning." });
      const id = await thread.create();
      const values = t.values(id);
      expect(values.policy_language ?? "", "the quote").toMatch(/Late Opening/i);
      expect(values.policy_violated ?? "", "the Policy Violated line").toMatch(/^Late Opening Policy, JBA Policy Manual p\.\d+/);
    },
  },
];
