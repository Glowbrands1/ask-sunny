import { expect, vi } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * "MAKE IT ABOUT …" ON A SAVED DRAFT: THE ACCOUNT, THE DATE AND THE TOPIC TOGETHER, OR NONE (ported from Ask Bubbles)
 * ============================================================================
 *
 * The sibling app's chain (QA's live tests there, 8–9 Nov 2026), checked on this app's main 8c772bf with the same draft
 * and wording (the person on this app's pack roster): a saved Coaching draft, Other "Missed monthly meeting", Date
 * 2026-10-10, Details about the missed meeting on 10/10/26. "make it about leaving the front desk unattended on 11/6/26":
 *   - the reader reads nothing: "I haven't changed the Coaching Form …", nothing saved;
 *   - the reader reads the topic: "Changed Other to 'Leaving the front desk unattended'", Details still the meeting and the
 *     Date still 10/10 — a half-changed draft.
 * The four flags, ported in order (`forms/form-patch-turn.ts`, `forms/form-write.ts`): STEP_B_MAKE_IT_ABOUT_ACCOUNT,
 * STEP_B_DATE_SAID, STEP_B_DATE_WITH_ABOUT, MADE_ABOUT_ALL_OR_NOTHING. The revision is scripted to write the new Details.
 */
const SAID = "make it about leaving the front desk unattended on 11/6/26";
const REQUEST = "create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26";
const DETAILS =
  "Observed:\nMarnie Holloway missed the monthly meeting on 10/10/26.\n\nExpectation:\nMarnie is expected to attend every scheduled meeting.";
const DESK = "Observed:\nMarnie Holloway left the front desk unattended on 11/6/26.\n\nExpectation:\nMarnie is expected to keep the front desk covered at all times.";
const TOPIC = patch("this_form", [
  { field: "other_topic", value: "Leaving the front desk unattended", how: "replace", evidence: "leaving the front desk unattended" },
  { field: "coaching_topics", options: ["other"], how: "replace", evidence: "make it about leaving the front desk unattended" },
]);
const CHAIN = ["STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED", "STEP_B_DATE_SAID_ENABLED", "STEP_B_DATE_WITH_ABOUT_ENABLED", "MADE_ABOUT_ALL_OR_NOTHING_ENABLED"];
const FIX = [...STEP_B_READER_FLAGS, "EDIT_MAKE_IT_ABOUT_ENABLED", ...CHAIN];
const REPORT = "Ported from the sibling app's make-it-about chain (QA, 8–9 Nov 2026); checked here on main 8c772bf: nothing, or Other alone";
const CHANGED = new Set(["coaching_details", "other_topic", "form_date"]);

async function onDraft(t: ReplayContext, said: string, reading: unknown, revised: string) {
  vi.setSystemTime(new Date("2026-11-09T13:15:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  if (reading) t.patchReads!({ [said]: reading as never });
  const thread = t.thread();
  await thread.say(REQUEST);
  t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
  const id = await thread.create();
  const before = savedForm(t, id);
  const valuesBefore = { ...t.values(id) };
  t.revisionWrites({ coaching_details: revised });
  const reply = await thread.say(said);
  replyMatchesDiff(t, id, before, reply, said);
  return { id, reply, before, valuesBefore };
}

function together(reading: unknown) {
  return async (t: ReplayContext) => {
    const { id, reply, valuesBefore } = await onDraft(t, SAID, reading, DESK);
    const saved = t.values(id);
    expect(saved.coaching_details ?? "", `Details:\n${reply.content}`).toMatch(/front desk unattended on 11\/6\/26/);
    expect(saved.coaching_details ?? "", "Details still about the meeting").not.toMatch(/monthly meeting/);
    expect(saved.other_topic ?? "", `Other:\n${reply.content}`).toMatch(/front desk/i);
    expect(saved.form_date, `the Date:\n${reply.content}`).toBe("2026-11-06");
    for (const [key, value] of Object.entries(valuesBefore)) {
      if (!CHANGED.has(key)) expect(saved[key], `${key} changed`).toBe(value);
    }
  };
}

const OPEN = { open: "nothing is saved, or Other alone with Details and the Date as before" };

export const NOV9_MAKE_IT_ABOUT_CHAIN_CASES: ReplayCase[] = [
  {
    id: "nov9-make-it-about-chain-no-reading",
    title: "\"make it about leaving the front desk unattended on 11/6/26\", the reader reads nothing: Other, the Date and Details together",
    report: REPORT,
    status: OPEN,
    fixFlags: FIX,
    run: together(undefined),
  },
  {
    id: "nov9-make-it-about-chain-other-form",
    title: "the same, the reader reads another form's turn: Other, the Date and Details together",
    report: REPORT,
    status: OPEN,
    fixFlags: FIX,
    run: together(patch("other", [])),
  },
  {
    id: "nov9-make-it-about-chain-topic",
    title: "the same, the reader reads the topic: Other, the Date and Details together, never Other alone",
    report: REPORT,
    status: OPEN,
    fixFlags: FIX,
    run: together(TOPIC),
  },
  {
    id: "nov9-make-it-about-chain-refused",
    title: "the same, the reader reads the topic and the revision's account is refused: nothing is saved, and the reply says so",
    report: `${REPORT} (the condition: one of them not written, none written)`,
    status: { open: "Other is saved alone (\"Changed Other to …\")" },
    fixFlags: FIX,
    async run(t) {
      const { id, reply, before } = await onDraft(t, SAID, TOPIC, "REWRITTEN");
      expect(savedForm(t, id), `the saved form changed:\n${reply.content}`).toBe(before);
      expect(reply.content, `the reply does not say what was not changed:\n${reply.content}`).toMatch(/I haven't changed the \*\*Coaching Form\*\*[^\n]*Details of Coaching/);
    },
  },
  {
    id: "nov9-make-it-about-chain-undated",
    title: "\"I need you to make it about showing up late\" (no date), the reader reads the topic: Details is rewritten, never only Other",
    report: `${REPORT} (STEP_B_MAKE_IT_ABOUT_ACCOUNT, the sibling's live 8 Nov case)`,
    status: { open: "Other is changed and Details stays about the meeting" },
    fixFlags: FIX,
    async run(t) {
      const said = "I need you to make it about showing up late";
      const { id, reply } = await onDraft(
        t,
        said,
        patch("this_form", [
          { field: "other_topic", value: "Showing up late", how: "replace", evidence: "showing up late" },
          { field: "coaching_topics", options: ["other"], how: "replace", evidence: "make it about showing up late" },
        ]),
        "Observed:\nMarnie Holloway showed up late on 10/10/26.\n\nExpectation:\nMarnie is expected to arrive on time.",
      );
      const details = t.values(id).coaching_details ?? "";
      expect(details, `Details:\n${reply.content}`).toMatch(/\blate\b/);
      expect(details, "Details still about the meeting").not.toMatch(/monthly meeting/);
    },
  },
  {
    id: "nov9-make-it-about-chain-date-said",
    title: "\"I need you to make it about showing up late and please list the policy make the date for 10/14/26\": the Date is 10/14 and the reply says Details was kept",
    report: `${REPORT} (STEP_B_DATE_SAID + STEP_B_DATE_WITH_ABOUT, the sibling's round-5 gate)`,
    status: { open: "the Date stays 2026-10-10" },
    fixFlags: FIX,
    async run(t) {
      const said = "I need you to make it about showing up late and please list the policy make the date for 10/14/26";
      const { id, reply } = await onDraft(
        t,
        said,
        patch("this_form", [{ field: "other_topic", value: "Showing up late", how: "replace", evidence: "showing up late" }]),
        DESK,
      );
      expect(t.values(id).form_date, `the Date:\n${reply.content}`).toBe("2026-10-14");
      expect(reply.content, `the reply does not say Details was kept:\n${reply.content}`).toMatch(/I kept \*\*Details of Coaching\*\* as it was/);
    },
  },
];
