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
      // With DRAFT_NO_INVENTED_PLAN on (QA r36), the drafted "Going Forward" is the model's and is dropped at Create, so
      // the reader adds the section the manager asked for rather than replacing it: the manager's own words, written.
      const reminder = "Ottoline will set a reminder for every scheduled meeting.";
      const rewritten = (
        /Going Forward:\n/.test(saved)
          ? saved.replace(/(Going Forward:\n)[^\n]+/, `$1${reminder}`)
          : saved.replace(/(\n\nPolicy reference:[^\n]*)?$/, `\n\nGoing Forward:\n${reminder}$1`)
      ).replace(/\n\n/g, "\n");
      t.patchReads!({ [SAID]: patch("this_form", [{ field: "coaching_details", value: rewritten, how: "replace", evidence: "she will set a reminder" }]) });
      await thread.say(SAID);
      const details = t.values(id).coaching_details ?? "";
      expect(details, details).toMatch(/set a reminder/);
      expect(details, `the sections lost their blank lines:\n${details}`).toMatch(/\n\nExpectation:/);
      expect(details, `the sections lost their blank lines:\n${details}`).toMatch(/\n\nGoing Forward:/);
    },
  },
];

/*
 * QA's Ask Sunny r37 live check (12 Nov 2026, main 7e8dcdb6; STEP_B_SECTION_SPACING on in production; names invented):
 * on coaching Details "Observed:\n… \n\nExpectation:\n…\n\nPolicy reference: …", the turn "make that update: he also
 * ignored a second client" saved the labels pulled onto the text line and no blank line before "Policy reference:".
 * The reader writes the field back in that shape, as live.
 */
const R37_REQUEST = "create a coaching form for Ottoline Ormsworth, on 11/9 she was rude to a client";
const R37_DETAILS =
  "Observed:\nOn 11/9, Ottoline Ormsworth was rude to a client.\n\nExpectation:\nOttoline Ormsworth is expected to greet every client politely.\n\nPolicy reference: Standards of Conduct Policy, JBA Policy Manual p.12";
const R37_SAID = "make that update: he also ignored a second client";
const R37_WRITTEN =
  "Observed: On 11/9, Ottoline Ormsworth was rude to a client and ignored a second client.\n\nExpectation: Ottoline Ormsworth is expected to greet every client politely.\nPolicy reference: Standards of Conduct Policy, JBA Policy Manual p.12";

export const NOV12_R37_SECTION_LABELS_CASES: ReplayCase[] = [
  {
    id: "nov12-r37-section-labels-and-policy-line-kept",
    title: "\"make that update: he also ignored a second client\": the labels stay on their own lines and Policy reference keeps its blank line",
    report: "QA's Ask Sunny r37 live check (12 Nov 2026): the labels were pulled onto the text line and the blank line before Policy reference was lost",
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-12T16:00:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(R37_REQUEST);
      t.draftWrites({ coaching_details: R37_DETAILS });
      const id = await thread.create();
      t.patchReads!({ [R37_SAID]: patch("this_form", [{ field: "coaching_details", value: R37_WRITTEN, how: "replace", evidence: "ignored a second client" }]) });
      await thread.say(R37_SAID);
      const details = t.values(id).coaching_details ?? "";
      expect(details, details).toMatch(/ignored a second client/);
      expect(details, `a label was pulled onto the text line:\n${details}`).toMatch(/^Observed:\nOn 11\/9/);
      expect(details, `a label was pulled onto the text line:\n${details}`).toMatch(/\n\nExpectation:\nOttoline/);
      expect(details, `the blank line before Policy reference was lost:\n${details}`).toMatch(/\n\nPolicy reference:/);
    },
  },
];
