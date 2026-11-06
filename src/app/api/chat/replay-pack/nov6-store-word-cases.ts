import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A SALON IS NEVER A MISSING PERSON (port of the sibling app's flip-3 gate,
 * QA, 6 Nov 2026; STORE_WORD_NOT_A_MISSING_PERSON_ENABLED)
 * ============================================================================
 *
 * In the sibling app, with the name flags on, "coaching form for <store
 * word>, …" was said back as "I couldn't find **<store word>** in the Woven
 * roster". Checked here: "coaching form for Kearney, …" said "I couldn't find
 * **Kearney** in the Woven roster" with the name flags on. This app has no
 * store-account rows in Woven (QA's read-only count, 6 Nov 2026: 0 of 164),
 * so only the salon word is fixed: a salon's name where a name goes is never
 * a person not found.
 */
const FLAGS = ["FORM_NAME_FROM_ROSTER_ENABLED", "ROSTER_NEAR_MISS_ENABLED", "ROSTER_NAME_IN_CANDIDATE_ENABLED", "STORE_WORD_NOT_A_MISSING_PERSON_ENABLED"];

export const NOV6_STORE_WORD_CASES: ReplayCase[] = [
  {
    id: "nov6-salon-word-never-a-missing-person",
    title: "\"coaching form for Kearney, the team was slow at the front desk on 11/2\": the salon is never said back as a person not found",
    report: "The sibling app's flip-3 gate (QA, 6 Nov 2026): a store word was said back as a person not found",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("coaching form for Kearney, the team was slow at the front desk on 11/2");
      expect(reply.content, `the salon is said back as a missing person:\n${reply.content}`).not.toMatch(/I couldn['’]t find \*\*Kearney\*\* in the Woven roster/);
      expect(thread.proposal?.employeeName ?? "", "the salon is the card's employee").not.toMatch(/^Kearney\b/);
    },
  },
];
