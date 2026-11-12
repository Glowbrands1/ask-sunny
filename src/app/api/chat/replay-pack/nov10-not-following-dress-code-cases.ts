import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase } from "./cases";
import { REFUSAL_ROSTER } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * "MAKE IT ABOUT NOT FOLLOWING THE DRESS CODE" WRITES THE DRESS CODE REFERENCE (QA's live report in the sibling app,
 * 10 Nov 2026; NOT_FOLLOWING_IS_VIOLATION_ENABLED)
 * ============================================================================
 *
 * On a saved Coaching draft whose Details carried "Policy reference: Attendance Policy, JBA Policy Manual p.14" (an earlier
 * made-about), "make it about not following the dress code" kept no dress-code reference: "not" + up to two words before
 * the policy topic set it aside (`forms/ca-policy.ts`, NEGATED_BEFORE), so no section was read from the manager's words.
 * The revision is scripted to write the account without "violated"/"broke" (the live wording that hid the bug). QA's
 * wording; the pack's invented person.
 */
/** The manual's Dress Code section, as the production manual rows hold it (`test/fixtures/jba-manual-production-151.json`). */
const DRESS_CODE_CHUNK = {
  chunkIndex: 44,
  chunkId: "jba-44",
  locator: "Page 15 — Dress Code for The Company",
  page: 16,
  content:
    "Dress Code for The Company\nThe Company Employees are to keep a neat, clean, professional appearance at all times. Anyone\nviolating their Brand’s Dress code policy will be sent home to change into proper work attire.",
  section: "Dress Code for The Company",
  printedPage: 15,
  sections: [
    { heading: "Dress Code for The Company", page: 15 },
    { heading: "All Locations Dress Code", page: 15 },
  ],
};
const DETAILS = "Observed:\nMarnie Holloway missed the monthly meeting on 10/10/26.\n\nExpectation:\nMarnie is expected to attend every scheduled meeting.";
const DRESS = "Observed:\nMarnie Holloway did not follow the dress code on 10/10/26.\n\nExpectation:\nMarnie is expected to follow the dress code on every shift.";

export const NOV10_NOT_FOLLOWING_DRESS_CODE_CASES: ReplayCase[] = [
  {
    id: "nov10-not-following-dress-code-reference",
    title: "after a made-about wrote the Attendance reference, \"make it about not following the dress code\": the stale Attendance line is gone and the Dress Code reference is written",
    report: "QA's live report (10 Nov 2026): \"make it about not following the dress code\" wrote no Dress Code reference",
    status: { open: "\"not following the dress code\" is read as no policy named, so no Dress Code reference is written" },
    fixFlags: ["NOT_FOLLOWING_IS_VIOLATION_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T14:00:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
      const thread = t.thread();
      await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
      t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
      const id = await thread.create();
      t.revisionWrites({ coaching_details: "Observed:\nMarnie Holloway showed up late on 10/10/26.\n\nExpectation:\nMarnie is expected to arrive on time for scheduled shifts." });
      await thread.say("I need you to make it about showing up late");
      expect(t.values(id).coaching_details ?? "", "the first turn's reference").toMatch(/Policy reference: Attendance Policy/);
      t.revisionWrites({ coaching_details: DRESS });
      const reply = await thread.say("make it about not following the dress code");
      const details = t.values(id).coaching_details ?? "";
      const lines = details.match(/Policy reference:[^\n]*/g) ?? [];
      expect(details, `Details:\n${reply.content}`).toMatch(/dress code/i);
      expect(lines.join("\n"), `the stale Attendance line:\n${details}`).not.toMatch(/Attendance/);
      expect(lines.join("\n"), `no Dress Code reference:\n${details}`).toMatch(/Dress Code/);
    },
  },
];
