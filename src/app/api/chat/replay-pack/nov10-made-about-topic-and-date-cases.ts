import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * QA'S LIVE ROUND 13 IN THE SIBLING APP (9 Nov 2026), PORTED: A SHORT TOPIC, AND THE DATE SAID ALONE
 * ============================================================================
 *
 * Both on fresh test drafts with Date 2026-10-10 and Other "Missed monthly meeting" (the person invented here).
 *
 * 1. "make it about being late on 11/5/26" saved the Date and Details; Other stayed "Missed monthly meeting" (the reply
 *    did not claim it). "make it about leaving the front desk unattended on 11/6/26" changed all three. The topic read
 *    from the manager's words, "Being late", came with "being late" as its evidence: two words, under the reducer's
 *    floor, so Other was refused, from the reader and from the code's own reading. MADE_ABOUT_TOPIC_EVIDENCE_ENABLED.
 * 2. "make the date 11/7/26" as the FIRST edit answered "I haven't changed the Coaching Form …" ("change the date to
 *    11/8/26" works through the correction path). The reader did not read the turn as this form's, and the old path's
 *    revision does not write the Date. The same with MADE_ABOUT_REWRITE_FINISHES off: not round 13's.
 *    FORM_DATE_SAID_ALONE_ENABLED.
 */
const DETAILS = "Observed:\nMarnie Holloway missed the monthly meeting on 10/10/26.\n\nExpectation:\nMarnie is expected to attend every scheduled meeting.";
const LATE_SAID = "make it about being late on 11/5/26";
const LATE = "Observed:\nMarnie Holloway was late on 11/5/26.\n\nExpectation:\nMarnie is expected to arrive on time for every shift.";
const DATE_SAID = "make the date 11/7/26";
const REPORT = "Ported from the sibling app: QA's live round 13 there (9 Nov 2026)";

async function onFreshDraft(t: ReplayContext, said: string, reading?: unknown) {
  vi.setSystemTime(new Date("2026-11-09T22:00:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  if (reading !== undefined) t.patchReads!({ [said]: reading as never });
  const thread = t.thread();
  await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
  t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
  const id = await thread.create();
  t.revisionWrites({ coaching_details: LATE });
  const reply = await thread.say(said);
  return { id, reply };
}

function lateAllThree(reading?: unknown) {
  return async (t: ReplayContext) => {
    const { id, reply } = await onFreshDraft(t, LATE_SAID, reading);
    const saved = t.values(id);
    expect(saved.form_date, `the Date:\n${reply.content}`).toBe("2026-11-05");
    expect(saved.coaching_details ?? "", `Details:\n${reply.content}`).toMatch(/late on 11\/5\/26/);
    expect(saved.other_topic ?? "", `Other stayed on the old topic:\n${reply.content}`).toMatch(/^being late$/i);
    expect(reply.content, `the reply does not say Other changed:\n${reply.content}`).toMatch(/Changed Other to/);
  };
}

const TOPIC_FIX = ["MADE_ABOUT_REWRITE_FINISHES_ENABLED", "MADE_ABOUT_TOPIC_EVIDENCE_ENABLED"];

export const NOV10_MADE_ABOUT_TOPIC_AND_DATE_CASES: ReplayCase[] = [
  {
    id: "nov10-made-about-short-topic-reader-other",
    title: "\"make it about being late on 11/5/26\", the reader sets Other \"Being late\": Other, the Date and Details together",
    report: `${REPORT}: Date and Details saved, Other stayed "Missed monthly meeting"`,
    status: { open: "Other \"Being late\" is refused: its evidence, \"being late\", is under the reducer's floor" },
    fixFlags: TOPIC_FIX,
    run: lateAllThree(patch("this_form", [{ field: "other_topic", value: "Being late", how: "replace", evidence: "being late" }])),
  },
  {
    id: "nov10-made-about-short-topic-no-reading",
    title: "\"make it about being late on 11/5/26\", no reading of this form: Other, the Date and Details together",
    report: `${REPORT}: Date and Details saved, Other stayed "Missed monthly meeting" (the reader's fallback shape)`,
    status: { open: "the topic read from the manager's words is refused: \"being late\" is under the reducer's floor" },
    fixFlags: TOPIC_FIX,
    run: lateAllThree(),
  },
  {
    id: "nov10-form-date-said-alone-first-edit",
    title: "\"make the date 11/7/26\" as the first edit, the reader does not read it as this form's: the Date is written",
    report: `${REPORT}: "I haven't changed the Coaching Form …" on the first edit`,
    status: { open: "a turn the reader reads as not this form's goes to the old path, which does not write the Date" },
    fixFlags: ["FORM_DATE_SAID_ALONE_ENABLED"],
    async run(t) {
      const { id, reply } = await onFreshDraft(t, DATE_SAID, patch("question", []));
      expect(t.values(id).form_date, `the Date:\n${reply.content}`).toBe("2026-11-07");
      expect(reply.content, `the reply does not say the Date changed:\n${reply.content}`).toMatch(/Changed Date to/);
    },
  },
  {
    id: "nov10-form-date-said-alone-negative",
    title: "negative: \"what is the date on this form?\" is a question, never a Date change",
    report: `${REPORT} (the condition: only a turn that says the date the form takes)`,
    status: "fixed",
    fixFlags: ["FORM_DATE_SAID_ALONE_ENABLED"],
    async run(t) {
      const { id } = await onFreshDraft(t, "what is the date on this form?", patch("question", []));
      expect(t.values(id).form_date).toBe("2026-10-10");
    },
  },
  {
    id: "nov10-made-about-said-date-saved-draft-live",
    title: "QA's live Sunny round 14: on a saved draft already about the front desk on 11/6/26, \"I need you to make it about showing up late and please list the policy make the date for 10/14/26\" with the reader writing the policy into Details: Details, Other and the Date are written",
    report: "QA's live Sunny round 14 (10 Nov 2026, 01:43Z): \"I haven't changed the Coaching Form …\", nothing saved",
    status: { open: "the reader's patch (policy words in Details) is refused whole and handed to the old path, whose revision will not drop 11/6/26" },
    fixFlags: [
      "MADE_ABOUT_READER_ACCOUNT_ENABLED",
      "MADE_ABOUT_POLICY_LINE_ENABLED",
      "MADE_ABOUT_REWRITE_FINISHES_ENABLED",
      "EDIT_POLICY_ASK_ENABLED",
      "MADE_ABOUT_SAID_DATE_ENABLED",
    ],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T01:41:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      const FIRST = "make it about leaving the front desk unattended on 11/6/26";
      const P9 = "I need you to make it about showing up late and please list the policy make the date for 10/14/26";
      const late = "Observed:\nMarnie Holloway showed up late.\n\nExpectation:\nMarnie is expected to arrive on time.";
      t.patchReads!({
        [FIRST]: patch("this_form", [{ field: "other_topic", value: "Leaving the front desk unattended", how: "replace", evidence: "leaving the front desk unattended" }]) as never,
        // The live reader, asked to list the policy, wrote it into Details: words the manager did not say.
        [P9]: patch("this_form", [
          { field: "other_topic", value: "Showing up late", how: "replace", evidence: "showing up late" },
          { field: "coaching_details", value: `${late}\n\nPolicy reference: Attendance Policy, JBA Policy Manual p.14`, how: "replace", evidence: "make it about showing up late" },
        ]) as never,
      });
      const thread = t.thread();
      await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
      t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
      const id = await thread.create();
      t.revisionWrites({ coaching_details: "Observed:\nMarnie Holloway left the front desk unattended on 11/6/26.\n\nExpectation:\nMarnie is expected to remain at the front desk." });
      await thread.say(FIRST);
      expect(t.values(id).form_date, "the first edit set the Date").toBe("2026-11-06");
      t.revisionWrites({ coaching_details: "Observed:\nMarnie Holloway showed up late on 10/14/26.\n\nExpectation:\nMarnie is expected to arrive on time." });
      const reply = await thread.say(P9);
      const saved = t.values(id);
      expect(reply.content, `nothing was saved:\n${reply.content}`).not.toMatch(/I haven't changed/);
      expect(saved.form_date, `the Date:\n${reply.content}`).toBe("2026-10-14");
      expect(saved.coaching_details ?? "", `Details:\n${reply.content}`).toMatch(/showed up late/);
      expect(saved.coaching_details ?? "", "Details still about the front desk").not.toMatch(/front desk/);
      expect(saved.other_topic ?? "", `Other:\n${reply.content}`).toMatch(/late/i);
    },
  },
];
