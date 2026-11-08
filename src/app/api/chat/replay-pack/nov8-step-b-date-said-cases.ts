import { expect, vi } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * "MAKE THE DATE FOR 10/14/26" ON A SAVED DRAFT WAS DROPPED, SILENTLY (QA, LIVE, 8 Nov 2026)
 * ============================================================================
 *
 * QA's live test in the sibling app's production (8 Nov 2026; EDIT_POLICY_ASK on; the person invented here): on a saved
 * Coaching draft dated 10/10/26, "I need you to make it about showing up late and please list the policy make the
 * date for 10/14/26" set Other = "Showing up late" and listed the policy, and the Date stayed 2026-10-10 with no word
 * about it. Step B's reader is never offered the form's Date (a reading with it is invalid, and the turn falls to the
 * old path). The live reading is scripted: the topic and its box. STEP_B_DATE_SAID_ENABLED (`forms/form-patch-turn.ts`).
 */

const SAID = "I need you to make it about showing up late and please list the policy make the date for 10/14/26";
const FIX = [...STEP_B_READER_FLAGS, "EDIT_POLICY_ASK_ENABLED", "STEP_B_DATE_SAID_ENABLED"];
const REPORT = "QA's live test, the sibling app's production, 8 Nov 2026: the Date stayed 10/10 on a saved draft, and the reply said nothing about it";

async function onDraft(t: ReplayContext, reading: unknown, said: string) {
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  t.patchReads!({ [said]: reading });
  const thread = t.thread();
  await thread.say("create a coaching form for Ottoline Ormsworth, she missed the monthly meeting on 10/10/26");
  t.draftWrites({ coaching_details: "Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline attends every scheduled meeting." });
  const id = await thread.create();
  expect(t.values(id).form_date, "the draft's Date before the edit").toBe("2026-10-10");
  const before = savedForm(t, id);
  const reply = await thread.say(said);
  replyMatchesDiff(t, id, before, reply, said);
  return { id, reply };
}

export const NOV8_STEP_B_DATE_SAID_CASES: ReplayCase[] = [
  {
    id: "nov8-step-b-date-said",
    title: "a saved draft, \"… make the date for 10/14/26\" (the reader sets the topic): the Date is 10/14/2026 and the reply says so",
    report: REPORT,
    status: { open: "the Date stays 2026-10-10 and the reply does not mention it" },
    fixFlags: FIX,
    async run(t) {
      const { id, reply } = await onDraft(
        t,
        patch("this_form", [
          { field: "other_topic", value: "Showing up late", how: "replace", evidence: "showing up late" },
          { field: "coaching_topics", options: ["other"], how: "replace", evidence: "make it about showing up late" },
        ]),
        SAID,
      );
      expect(t.values(id).form_date, "the Date the manager said").toBe("2026-10-14");
      expect(t.values(id).other_topic ?? "", "the reader's topic").toMatch(/late/i);
      expect(reply.content, `the reply does not say the Date changed:\n${reply.content}`).toMatch(/Changed Date to/);
    },
  },
  {
    id: "nov8-step-b-date-said-alone",
    title: "…\"make the date for 10/14/26\" alone (the reader sets nothing): the Date is written and said",
    report: REPORT,
    status: { open: "the Date stays 2026-10-10" },
    fixFlags: FIX,
    async run(t) {
      const { id, reply } = await onDraft(t, patch("this_form", []), "make the date for 10/14/26");
      expect(t.values(id).form_date, "the Date the manager said").toBe("2026-10-14");
      expect(reply.content, `the reply does not say the Date changed:\n${reply.content}`).toMatch(/Changed Date to/);
    },
  },
];
