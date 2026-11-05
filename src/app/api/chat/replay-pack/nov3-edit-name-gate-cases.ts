import { expect } from "vitest";

import { STAFF, KEARNEY, type ReplayCase } from "./cases";

/**
 * Master plan step 2 (3 Nov 2026), QA's root cause 2: with a form open, an
 * edit whose capitalised words ("Must", "Practice", "Daily Stats", "Dez")
 * read as another person was dropped for the ordinary answer. Person invented.
 */
export const NOV3_EDIT_NAME_GATE_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-edit-capitalised-words",
    title: "with her Coaching draft open, an edit with capitalised words that are nobody on the roster is written into her draft",
    report:
      "QA (master plan, 3 Nov 2026): \"Names from capitals; form edit dropped\" — Must / Practice / Daily Stats / Dez read as other people in an edit to the open form.",
    // Fixed in production: FORM_EDIT_NAME_GATE_ROSTER_ENABLED on (QA, 3 Nov 2026).
    // fails with production's real flags (QA Vercel read 5 Nov); tracked: POLICY_CITATION_ENABLED (on in production) — the edit to her open Coaching draft is dropped.
    status: { open: "fails with production's real flags (QA Vercel read 5 Nov); tracked: POLICY_CITATION_ENABLED (on in production) — the edit to her open Coaching draft is dropped" },
    fixStatus: { open: "fails with production's real flags (QA Vercel read 5 Nov); tracked: POLICY_CITATION_ENABLED (on in production) — the edit to her open Coaching draft is dropped" },
    fixFlags: ["FORM_EDIT_NAME_GATE_ROSTER_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("coaching form for Marnie Holloway, she skipped the opening checklist today");
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Marnie Holloway" });
      t.draftWrites({ coaching_details: "Observed:\nMarnie skipped the opening checklist today." });
      await thread.create();
      t.revisionWrites({ coaching_details: "Observed:\nMarnie skipped the opening checklist today. She will practise the checklist with her lead before the daily stats review." });
      const reply = await thread.say("Add that she Must Practice the checklist with Dez before Daily Stats.");
      expect(reply.formUpdate?.updated ?? [], `the edit was dropped: ${reply.content}`).toContain("coaching_details");
    },
  },
];
