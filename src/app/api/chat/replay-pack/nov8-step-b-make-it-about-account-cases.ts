import { expect, vi } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * "MAKE IT ABOUT …" ON A SAVED DRAFT CHANGED ONLY THE TOPIC (QA, LIVE, 8 Nov 2026)
 * ============================================================================
 *
 * QA's live draft test in the sibling app's production (Coaching Form v1, 19:39–19:42Z, 8 Nov 2026; the person is
 * invented here): with Step B and EDIT_MAKE_IT_ABOUT on, "I need you to make it about showing up late" answered
 * "Changed Other to 'Showing up late'". The reader (the live model) set only the Other topic, so Details of Coaching
 * stayed about the missed meeting. The scripted reading below is what the live model returned; the old path's
 * revision (EDIT_MAKE_IT_ABOUT) is what rewrites the account when the turn reaches it.
 * STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED (`forms/form-patch-turn.ts`, `forms/form-patch-prompt.ts`).
 */

export const STEP_B_MAKE_IT_ABOUT = "I need you to make it about showing up late";
const REQUEST = "create a coaching form for Ottoline Ormsworth, she missed the monthly meeting on 10/10/26";
const DETAILS =
  "Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline is expected to attend every scheduled meeting.\n\nGoing Forward:\nOttoline will put every scheduled meeting on her calendar.";
// The old path's revision keeps every protected value the account held (her name, the date), so its scripted write
// keeps "on 10/10/26"; a write that drops the date is refused there, as the revision's own rules say.
const LATE =
  "Observed:\nOttoline Ormsworth showed up late on 10/10/26.\n\nExpectation:\nOttoline is expected to arrive on time.\n\nGoing Forward:\nOttoline will arrive on time for every scheduled shift.";
const FIX = [...STEP_B_READER_FLAGS, "EDIT_MAKE_IT_ABOUT_ENABLED", "STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED"];
const REPORT = "QA's live draft test, the sibling app's production, 8 Nov 2026 19:39–19:42Z: \"Changed Other to 'Showing up late'\"; Details stayed about the meeting";

export const NOV8_STEP_B_MAKE_IT_ABOUT_ACCOUNT_CASES: ReplayCase[] = [
  {
    id: "nov8-step-b-make-it-about-topic-only",
    title: "a saved Coaching draft, \"I need you to make it about showing up late\": the reader sets only the topic; Details of Coaching is rewritten to be about showing up late, never left about the meeting",
    report: REPORT,
    status: { open: "Details of Coaching stays about the missed meeting; the reply says only \"Changed Other to 'Showing up late'\"" },
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-07T19:40:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      t.patchReads!({
        [STEP_B_MAKE_IT_ABOUT]: patch("this_form", [
          { field: "other_topic", value: "Showing up late", how: "replace", evidence: "showing up late" },
          { field: "coaching_topics", options: ["other"], how: "replace", evidence: "make it about showing up late" },
        ]),
      });
      const thread = t.thread();
      await thread.say(REQUEST);
      t.draftWrites({ coaching_details: DETAILS });
      const id = await thread.create();
      t.revisionWrites({ coaching_details: LATE });
      const before = savedForm(t, id);
      const reply = await thread.say(STEP_B_MAKE_IT_ABOUT);
      replyMatchesDiff(t, id, before, reply, STEP_B_MAKE_IT_ABOUT);
      const details = t.values(id).coaching_details ?? "";
      expect(details, `Details of Coaching is not about showing up late:\n${details}\nreply: ${reply.content}`).toMatch(/\blate\b/i);
      expect(details, "Details of Coaching is still about the missed meeting").not.toMatch(/monthly meeting/i);
      expect(details, "the outline is lost").toMatch(/Observed:[\s\S]*Expectation:/);
    },
  },
];
