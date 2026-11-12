import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * AFTER AN EDIT, THE SECTIONS KEEP THEIR BLANK LINES (ported from Ask Bubbles; STEP_B_SECTION_SPACING_ENABLED)
 * ============================================================================
 *
 * QA's live draft test on Ask Bubbles production (Coaching Form v1, 8 Nov 2026): after an edit of a Details of Coaching
 * written "Observed: … / Expectation: … / Going Forward: …", the blank lines between the sections became single
 * newlines. Split out of #662 (QA, 12 Nov 2026). The reader writes the field back with single newlines, as live; the
 * person is invented (the refusal roster's).
 */
const REQUEST = "create a coaching form for Ottoline Ormsworth, she missed the monthly meeting on 10/10/26";
const DETAILS =
  "Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline is expected to attend every scheduled meeting.\n\nGoing Forward:\nOttoline will put every scheduled meeting on her calendar.";
const SAID = "change going forward to say she will set a reminder for every scheduled meeting";

export const NOV12_STEP_B_SECTION_SPACING_CASES: ReplayCase[] = [
  {
    id: "nov12-step-b-section-spacing-kept",
    title: "an edit the reader writes back with single newlines keeps the blank line before Expectation and Going Forward",
    report: "Ported from Ask Bubbles (QA's live draft test, 8 Nov 2026): the blank lines between the sections collapsed after an edit",
    // Changed on purpose (12 Nov 2026): fixed in production by STEP_B_SECTION_SPACING_ENABLED, QA round 36. Was OPEN.
    status: "fixed",
    fixFlags: [...STEP_B_READER_FLAGS, "STEP_B_SECTION_SPACING_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-07T19:40:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(REQUEST);
      t.draftWrites({ coaching_details: DETAILS });
      const id = await thread.create();
      const saved = t.values(id).coaching_details ?? "";
      const rewritten = saved
        .replace(/(Going Forward:\n)[^\n]+/, "$1Ottoline will set a reminder for every scheduled meeting.")
        .replace(/\n\n/g, "\n");
      t.patchReads!({ [SAID]: patch("this_form", [{ field: "coaching_details", value: rewritten, how: "replace", evidence: "she will set a reminder" }]) });
      await thread.say(SAID);
      const details = t.values(id).coaching_details ?? "";
      expect(details, details).toMatch(/set a reminder/);
      expect(details, `the sections lost their blank lines:\n${details}`).toMatch(/\n\nExpectation:/);
      expect(details, `the sections lost their blank lines:\n${details}`).toMatch(/\n\nGoing Forward:/);
    },
  },
];
