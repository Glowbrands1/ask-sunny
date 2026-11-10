import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A FIRST NAME IN COACHING DETAILS IS THE NAME (ported from Ask Bubbles; QA's live round 17b, 10 Nov 2026)
 * ============================================================================
 *
 * DRAFT_WRITE_NEVER_SILENT's note said "The draft left out <surname> in Details of Coaching" while Details named the
 * employee by first name. FIRST_NAME_ENOUGH_ENABLED. The employee is the pack's Rowan Kestrel.
 */
const DETAILS = "Observed:\nRowan missed the monthly meeting on 11/9/26.\n\nExpectation:\nRowan is expected to attend every scheduled meeting.";
const SAID = "create a coaching form for Rowan Kestrel, she missed the monthly meeting on 11/9/26";

export const NOV10_FIRST_NAME_ENOUGH_CASES: ReplayCase[] = [
  {
    id: "nov10-r17b-first-name-enough",
    title: "Details names the employee by first name: the draft's note does not say the surname was left out",
    report: "QA's live round 17b (10 Nov 2026), gap 3 (DRAFT_WRITE_NEVER_SILENT)",
    status: { open: "\"The draft left out Kestrel in Details of Coaching\"" },
    fixFlags: ["FIRST_NAME_ENOUGH_ENABLED"],
    async run(t: ReplayContext) {
      vi.setSystemTime(new Date("2026-11-10T22:30:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(SAID);
      t.draftWrites({ coaching_details: DETAILS });
      const id = await thread.create();
      t.draftWrites({ coaching_details: DETAILS });
      const response = JSON.stringify(await t.redraft(id, SAID));
      expect(response, "the note says the surname was left out though Details names her").not.toMatch(/left out[^"]*Kestrel/);
    },
  },
];
