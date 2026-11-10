import { expect, vi } from "vitest";

import { KEARNEY, savedForm, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * AN UNDATED "MAKE IT ABOUT …" CHANGES DETAILS AND THE TOPIC TOGETHER, OR NEITHER (QA's round-11 gate)
 * ============================================================================
 *
 * QA's round-11 gate on this app (9 Nov 2026; the person on this app's pack roster): with the chain on, "I need you to make it about showing up late" (no date)
 * on a saved Coaching draft about the missed meeting rewrote Details of Coaching and left Other "Missed monthly meeting",
 * the mirror of the chain-off Other-only change. QA: the topic with Details, or neither; the Date stays (no date was
 * said), and the reply says so. MADE_ABOUT_UNDATED_TOGETHER_ENABLED (`forms/form-patch-turn.ts`).
 */
const SAID = "I need you to make it about showing up late";
const DETAILS = "Observed:\nMarnie Holloway missed the monthly meeting on 10/10/26.\n\nExpectation:\nMarnie is expected to attend every scheduled meeting.";
const LATE = "Observed:\nMarnie Holloway showed up late on 10/10/26.\n\nExpectation:\nMarnie is expected to arrive on time.";
const TOPIC = patch("this_form", [
  { field: "other_topic", value: "Showing up late", how: "replace", evidence: "showing up late" },
  { field: "coaching_topics", options: ["other"], how: "replace", evidence: "make it about showing up late" },
]);
const FIX = [
  ...STEP_B_READER_FLAGS,
  "EDIT_MAKE_IT_ABOUT_ENABLED",
  "STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED",
  "STEP_B_DATE_SAID_ENABLED",
  "STEP_B_DATE_WITH_ABOUT_ENABLED",
  "MADE_ABOUT_ALL_OR_NOTHING_ENABLED",
  "MADE_ABOUT_UNDATED_TOGETHER_ENABLED",
];
const REPORT = "QA's round-11 gate (9 Nov 2026): the undated make-it-about rewrote Details and left Other on the old topic";

async function onDraft(t: ReplayContext, reading: unknown, revised: string) {
  vi.setSystemTime(new Date("2026-11-09T15:00:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  if (reading) t.patchReads!({ [SAID]: reading as never });
  const thread = t.thread();
  await thread.say("create a coaching form for Marnie Holloway, she missed the monthly meeting on 10/10/26");
  t.draftWrites({ coaching_details: DETAILS, other_topic: "Missed monthly meeting" }, { coaching_topics: ["other"] });
  const id = await thread.create();
  const before = savedForm(t, id);
  t.revisionWrites({ coaching_details: revised });
  const reply = await thread.say(SAID);
  return { id, reply, before };
}

function together(reading: unknown) {
  return async (t: ReplayContext) => {
    const { id, reply } = await onDraft(t, reading, LATE);
    const saved = t.values(id);
    expect(saved.coaching_details ?? "", `Details:\n${reply.content}`).toMatch(/showed up late/);
    expect(saved.other_topic ?? "", `Other is still the old topic:\n${reply.content}`).toMatch(/late/i);
    expect(saved.form_date, `the Date:\n${reply.content}`).toBe("2026-10-10");
    expect(reply.content, `the reply does not say the Date stays:\n${reply.content}`).toMatch(/The \*\*Date\*\* stays 2026-10-10; tell me if it should change\./);
  };
}

export const NOV9_MADE_ABOUT_UNDATED_TOGETHER_CASES: ReplayCase[] = [
  {
    id: "nov9-made-about-undated-topic",
    title: "\"I need you to make it about showing up late\", the reader reads the topic: Details and Other together, the Date stays and the reply says so",
    report: REPORT,
    // Changed on purpose (10 Nov 2026): fixed in production by MADE_ABOUT_UNDATED_TOGETHER, QA round 15.
    status: "fixed",
    fixFlags: FIX,
    run: together(TOPIC),
  },
  {
    id: "nov9-made-about-undated-no-reading",
    title: "the same, the reader reads nothing: the topic from the manager's words, with Details",
    report: REPORT,
    // Changed on purpose (10 Nov 2026): fixed in production by MADE_ABOUT_UNDATED_TOGETHER, QA round 15.
    status: "fixed",
    fixFlags: FIX,
    run: together(undefined),
  },
  {
    id: "nov9-made-about-undated-refused",
    title: "the same, the reader reads the topic and the revision's account is refused: neither is saved, and the reply says so",
    report: `${REPORT} (the condition: Details and the topic together, or neither)`,
    // Open here (unlike the sibling app): with the chain off, the reader's topic is saved alone.
    // Changed on purpose (9 Nov 2026): already holds with production's flags since MADE_ABOUT_ALL_OR_NOTHING went live (QA round 11); marked fixed in QA round 13.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { id, reply, before } = await onDraft(t, TOPIC, "REWRITTEN");
      expect(savedForm(t, id), `the saved form changed:\n${reply.content}`).toBe(before);
      expect(reply.content, `the reply says the form changed:\n${reply.content}`).not.toMatch(/^Updated the|^Changed /m);
    },
  },
];
