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

const P9 = "I need you to make it about showing up late and please list the policy make the date for 10/14/26";
const SAID_DATE_FIX = [
  "MADE_ABOUT_READER_ACCOUNT_ENABLED",
  "MADE_ABOUT_POLICY_LINE_ENABLED",
  "MADE_ABOUT_REWRITE_FINISHES_ENABLED",
  "EDIT_POLICY_ASK_ENABLED",
  "MADE_ABOUT_SAID_DATE_ENABLED",
];
const VAGUE = "Observed:\nNo specific incident or coaching discussion was described.\n\nExpectation:\nMarnie is expected to meet the standards of the role.";

/**
 * P9's combined sentence. The reader (as gate runner 2's probe) replaces Other and Details and says the policy was asked
 * for; the revision writes Details about showing up late WITHOUT the date (the live revision need not repeat it). Saved:
 * after "make it about leaving the front desk unattended on 11/6/26". Vague: the first edit of a draft with no incident.
 */
function p9(shape: { readonly saved: boolean }) {
  return async (t: ReplayContext) => {
    vi.setSystemTime(new Date("2026-11-10T01:41:00Z"));
    t.directory(REFUSAL_ROSTER);
    t.as("salon_director", KEARNEY);
    const FIRST = "make it about leaving the front desk unattended on 11/6/26";
    const desk = "Observed:\nMarnie Holloway left the front desk unattended on 11/6/26.\n\nExpectation:\nMarnie is expected to remain at the front desk.";
    const late = "Observed:\nMarnie Holloway showed up late.\n\nExpectation:\nMarnie is expected to arrive on time.";
    t.patchReads!({
      [FIRST]: patch("this_form", [
        { field: "other_topic", value: "Leaving the front desk unattended", how: "replace", evidence: "leaving the front desk unattended" },
        { field: "coaching_details", value: desk, how: "replace", evidence: "leaving the front desk unattended on 11/6/26" },
      ]) as never,
      [P9]: {
        ...patch("this_form", [
          { field: "other_topic", value: "Showing up late", how: "replace", evidence: "showing up late" },
          { field: "coaching_details", value: late, how: "replace", evidence: "showing up late" },
        ]),
        policy_asked: true,
      } as never,
    });
    const thread = t.thread();
    if (shape.saved) {
      await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
      t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
    } else {
      await thread.say("create a coaching form for Marnie Holloway");
      t.draftWrites({ coaching_details: VAGUE });
    }
    const id = await thread.create();
    if (shape.saved) {
      t.revisionWrites({ coaching_details: desk });
      await thread.say(FIRST);
      expect(t.values(id).form_date, "the first edit set the Date").toBe("2026-11-06");
    }
    t.revisionWrites({ coaching_details: late });
    const reply = await thread.say(P9);
    const saved = t.values(id);
    expect(reply.content, `nothing was saved:\n${reply.content}`).not.toMatch(/everything on it is as it was/);
    expect(saved.form_date, `the Date:\n${reply.content}`).toBe("2026-10-14");
    expect(saved.coaching_details ?? "", `Details:\n${reply.content}`).toMatch(/showed up late/);
    expect(saved.coaching_details ?? "", "Details still about the old account").not.toMatch(/front desk|No specific incident/);
    expect(saved.other_topic ?? "", `Other:\n${reply.content}`).toMatch(/late/i);
    expect(saved.coaching_details ?? "", `the policy line:\n${saved.coaching_details}`).toMatch(/Policy reference: .*JBA Policy Manual p\.\d+/);
  };
}

const ATTENDANCE_LINE = "Policy reference: Attendance Policy, JBA Policy Manual p.14";
const WORK_AREA_LINE = {
  chunkIndex: 39.5,
  chunkId: "jba-39-5",
  locator: "Page 13 — Standards of Conduct",
  page: 14,
  content: "o Unapproved absence from the work area during a shift",
  section: "Standards of Conduct",
  printedPage: 13,
  sections: [],
};

/**
 * QA's live Sunny round 15 (10 Nov 2026, 03:05–03:06Z): two made-about turns in a row. "I need you to make it about showing
 * up late" wrote the Attendance reference; "make it about leaving the front desk unattended on 11/6/26" then saved
 * "Policy reference: Standards of Conduct Policy, JBA Policy Manual p.13; Attendance Policy, JBA Policy Manual p.14". The
 * second revision kept the first turn's line in a shape the splitter does not read as the app's own: with a trailing
 * period (the live result: both sections), or not as the last paragraph (the old reference kept, none for the new one).
 */
function chainedLine(kept: "period" | "middle") {
  return async (t: ReplayContext) => {
    vi.setSystemTime(new Date("2026-11-10T03:04:00Z"));
    t.directory(REFUSAL_ROSTER);
    t.as("salon_director", KEARNEY);
    t.manualAlsoHas?.([WORK_AREA_LINE]);
    const thread = t.thread();
    await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
    t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
    const id = await thread.create();
    t.revisionWrites({ coaching_details: "Observed:\nMarnie Holloway showed up late on 10/10/26.\n\nExpectation:\nMarnie is expected to arrive on time for scheduled shifts." });
    await thread.say("I need you to make it about showing up late");
    expect(t.values(id).coaching_details ?? "", "the first turn's reference").toMatch(new RegExp(`${ATTENDANCE_LINE.replace(/[.]/g, "\\.")}$`));
    const observed = "Observed:\nMarnie Holloway left the front desk unattended on 11/6/26.";
    const expectation = "Expectation:\nMarnie is expected to ensure the front desk remains attended at all times during scheduled shifts.";
    t.revisionWrites({
      coaching_details: kept === "period" ? `${observed}\n\n${expectation}\n\n${ATTENDANCE_LINE}.` : `${observed}\n\n${ATTENDANCE_LINE}\n\n${expectation}`,
    });
    const reply = await thread.say("make it about leaving the front desk unattended on 11/6/26");
    const details = t.values(id).coaching_details ?? "";
    expect(details, `Details:\n${reply.content}`).toMatch(/front desk unattended on 11\/6\/26/);
    expect(details.match(/Policy reference:[^\n]*/g) ?? [], `the policy lines:\n${details}`).toEqual(["Policy reference: Standards of Conduct Policy, JBA Policy Manual p.13"]);
  };
}

export const NOV10_MADE_ABOUT_TOPIC_AND_DATE_CASES: ReplayCase[] = [
  {
    id: "nov10-made-about-short-topic-reader-other",
    title: "\"make it about being late on 11/5/26\", the reader sets Other \"Being late\": Other, the Date and Details together",
    report: `${REPORT}: Date and Details saved, Other stayed "Missed monthly meeting"`,
    // Changed on purpose (10 Nov 2026): fixed in production, QA round 18
    status: "fixed",
    fixFlags: TOPIC_FIX,
    run: lateAllThree(patch("this_form", [{ field: "other_topic", value: "Being late", how: "replace", evidence: "being late" }])),
  },
  {
    id: "nov10-made-about-short-topic-no-reading",
    title: "\"make it about being late on 11/5/26\", no reading of this form: Other, the Date and Details together",
    report: `${REPORT}: Date and Details saved, Other stayed "Missed monthly meeting" (the reader's fallback shape)`,
    // Changed on purpose (10 Nov 2026): fixed in production, QA round 18
    status: "fixed",
    fixFlags: TOPIC_FIX,
    run: lateAllThree(),
  },
  {
    id: "nov10-form-date-said-alone-first-edit",
    title: "\"make the date 11/7/26\" as the first edit, the reader does not read it as this form's: the Date is written",
    report: `${REPORT}: "I haven't changed the Coaching Form …" on the first edit`,
    // Changed on purpose (10 Nov 2026): fixed in production, QA round 18
    status: "fixed",
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
    title: "QA's live Sunny round 14 (P9): on a saved draft already about the front desk on 11/6/26, \"I need you to make it about showing up late and please list the policy make the date for 10/14/26\", the reader's patch refused and the revision writing Details without a date: Date, Details, Other and the policy line are saved",
    report: "QA's live Sunny round 14 (10 Nov 2026, 01:43Z, P9 from 7 Nov): \"I haven't changed the Coaching Form …\", nothing saved",
    // Changed on purpose (10 Nov 2026): holds with production's flags since QA's round 15 (main ed18d1fc: the four MADE_ABOUT
    // switches on, UNDATED_TOGETHER among them), as QA's live P9 save at 03:07:44Z showed. Kept as fixed, with the fix flags too.
    status: "fixed",
    fixFlags: SAID_DATE_FIX,
    run: p9({ saved: true }),
  },
  {
    id: "nov10-made-about-said-date-vague-draft-live",
    title: "QA's live Sunny round 14 (P9, its original shape): the sentence as the FIRST edit of a draft whose Details say \"No specific incident…\" and with no Other: Date, Details, Other and the policy line are saved",
    report: "QA's live Sunny round 14 (10 Nov 2026, 01:47Z, conv_mwa14fdh2cds42a): \"I haven't changed …\", nothing saved",
    // Changed on purpose (10 Nov 2026): fixed in production, QA round 18
    status: "fixed",
    fixFlags: SAID_DATE_FIX,
    run: p9({ saved: false }),
  },
  ...(["period", "middle"] as const).map(
    (kept): ReplayCase => ({
      id: `nov10-made-about-policy-line-chained-${kept}`,
      title: `QA's live Sunny round 15: two made-about turns in a row, the revision keeping the first turn's Attendance line ${kept === "period" ? "with a trailing period" : "mid-text"}: the new Details carries the Standards of Conduct reference alone`,
      report: "QA's live Sunny round 15 (10 Nov 2026, 03:06Z): \"Policy reference: Standards of Conduct Policy, JBA Policy Manual p.13; Attendance Policy, JBA Policy Manual p.14\"",
      // Changed on purpose (10 Nov 2026): fixed in production, QA round 18
      status: "fixed",
      fixFlags: [
        "MADE_ABOUT_READER_ACCOUNT_ENABLED",
        "MADE_ABOUT_UNDATED_TOGETHER_ENABLED",
        "MADE_ABOUT_POLICY_LINE_ENABLED",
        "MADE_ABOUT_REWRITE_FINISHES_ENABLED",
        "MADE_ABOUT_POLICY_LINE_REPLACES_ENABLED",
      ],
      run: chainedLine(kept),
    }),
  ),
  {
    id: "nov10-section-breaks-kept-p9-one-line",
    title: "QA's live Sunny round 15 (03:07:44Z): P9's sentence saved, but the reader returned Details on ONE line (\"Observed: … Expectation: …\"): the saved Details keep their sections",
    report: "QA's live Sunny round 15 (10 Nov 2026, 03:07:44Z): Details of Coaching saved as one paragraph",
    status: { open: "the reader's one-line account is written as it came, over a field written in sections" },
    fixFlags: [
      "MADE_ABOUT_READER_ACCOUNT_ENABLED",
      "MADE_ABOUT_UNDATED_TOGETHER_ENABLED",
      "MADE_ABOUT_POLICY_LINE_ENABLED",
      "MADE_ABOUT_REWRITE_FINISHES_ENABLED",
      "EDIT_POLICY_ASK_ENABLED",
      "SECTION_BREAKS_KEPT_ENABLED",
    ],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T03:04:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      // The draft's own sections (Observed, Expectation), run onto one line by the reader.
      const flat = "Observed: Marnie Holloway showed up late on 10/14/26. Expectation: Marnie is expected to be on time at all times.";
      t.patchReads!({
        [P9]: {
          ...patch("this_form", [
            { field: "other_topic", value: "Showing up late", how: "replace", evidence: "showing up late" },
            { field: "coaching_details", value: flat, how: "replace", evidence: "make it about showing up late" },
          ]),
          policy_asked: true,
        } as never,
      });
      const thread = t.thread();
      await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
      t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
      const id = await thread.create();
      // The live chain on that draft: undated "showing up late", then the front desk on 11/6/26, then P9.
      t.manualAlsoHas?.([WORK_AREA_LINE]);
      t.revisionWrites({ coaching_details: "Observed:\nMarnie Holloway showed up late on 10/10/26.\n\nExpectation:\nMarnie is expected to arrive on time for scheduled shifts." });
      await thread.say("I need you to make it about showing up late");
      t.revisionWrites({ coaching_details: "Observed:\nMarnie Holloway left the front desk unattended on 11/6/26.\n\nExpectation:\nMarnie is expected to keep the front desk covered at all times." });
      await thread.say("make it about leaving the front desk unattended on 11/6/26");
      expect(t.values(id).coaching_details ?? "", "the chain's second turn").toMatch(/front desk unattended on 11\/6\/26/);
      const reply = await thread.say(P9);
      const details = t.values(id).coaching_details ?? "";
      expect(details, `Details:\n${reply.content}`).toMatch(/showed up late on 10\/14\/26/);
      expect(details, `the sections were run into one paragraph:\n${details}`).toMatch(/^Observed:\n[^\n]+\n\nExpectation:\n[^\n]+/);
    },
  },
  {
    id: "nov10-add-not-repeated-after-made-about",
    title: "Ported from Ask Bubbles' live round 15: \"make it about being late on 11/5/26\", then \"add that she was reminded of the policy\" with the reader returning the whole field (on one line) and the new sentence as an add: Details hold ONE copy of the account plus the new line",
    report: "Ported from Ask Bubbles: QA's live round 15 there (10 Nov 2026, 04:53Z): the whole Observed/Expectation/Going Forward block saved twice, then the new line",
    // Changed on purpose (10 Nov 2026): fixed in production, QA round 18
    status: "fixed",
    fixFlags: ["MADE_ABOUT_TOPIC_EVIDENCE_ENABLED", "FORM_DATE_SAID_ALONE_ENABLED", "ADD_NOT_REPEATED_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T04:52:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      const late =
        "Observed:\nMarnie Holloway was late on 11/5/26.\n\nExpectation:\nMarnie is expected to arrive on time for all scheduled shifts.\n\nGoing Forward:\nMarnie will arrive on time for every shift.";
      const add = "add that she was reminded of the policy";
      const line = "Marnie was reminded of the policy.";
      const thread = t.thread();
      await thread.say("create a coaching form for Marnie Holloway, missed the monthly meeting on 10/10/26");
      t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
      const id = await thread.create();
      t.revisionWrites({ coaching_details: late });
      await thread.say("make it about being late on 11/5/26");
      // This app's MADE_ABOUT_POLICY_LINE may add the new account's reference after it.
      const made = t.values(id).coaching_details ?? "";
      expect(made.startsWith(late), `the made-about turn:\n${made}`).toBe(true);
      // The reader echoes the field as saved (here with its reference line), run onto one line, then the new sentence.
      t.patchReads!({
        [add]: patch("this_form", [{ field: "coaching_details", value: `${made.replace(/\n+/g, " ")} ${line}`, how: "add", evidence: "she was reminded of the policy" }]) as never,
      });
      const reply = await thread.say(add);
      const details = t.values(id).coaching_details ?? "";
      expect(details.match(/Observed:/g) ?? [], `the account was saved twice:\n${details}`).toHaveLength(1);
      expect(details.match(/Going Forward:/g) ?? [], `the account was saved twice:\n${details}`).toHaveLength(1);
      expect(details, `the new line:\n${reply.content}`).toMatch(/reminded of the policy/);
      expect(details.startsWith(made), `the account changed:\n${details}`).toBe(true);
    },
  },
];
