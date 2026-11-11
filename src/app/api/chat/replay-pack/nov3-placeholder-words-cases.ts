import { expect } from "vitest";

import { STAFF, KEARNEY, type ReplayCase } from "./cases";

/**
 * Master plan step 5 (3 Nov 2026), QA: "TBD / N/A still are not" caught by the
 * placeholder guard — a drafted "The cost to the salon is TBD." reached the form (a follow-up
 * date sentence is already removed as scheduling talk).
 * Person invented. "N/A" stays: it is often the manager's own answer.
 */
export const NOV3_PLACEHOLDER_WORDS_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-placeholder-tbd",
    title: "a drafted \"TBD\" never reaches the form; every other sentence of the draft does",
    report: "QA (master plan, 3 Nov 2026): placeholder values such as TBD are written into drafted fields.",
    // Fixed in production: FORM_PLACEHOLDER_WORDS_ENABLED on (QA, 3 Nov 2026).
    status: "fixed",
    fixFlags: ["FORM_PLACEHOLDER_WORDS_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("coaching form for Marnie Holloway, she skipped the opening checklist today");
      t.draftWrites({ coaching_details: "Observed:\nMarnie skipped the opening checklist today. The cost to the salon is TBD." });
      const id = await thread.create();
      const details = t.values(id).coaching_details ?? "";
      expect(details, "the placeholder reached the form").not.toMatch(/\bTBD\b/);
      expect(details, "a sentence without a placeholder was lost").toMatch(/skipped the opening checklist today\./);
    },
  },
];
