import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "THE MEETING WAS ACTUALLY ON 10-19-26": THE CARD AND THE SAVED FORM TAKE THE CORRECTED DATE (QA, 8 Nov 2026)
 * ============================================================================
 *
 * QA's round-5 trace of corrective-action-conversation-qa-e2e "Q6 corrections before the draft is created", with
 * production's flags (and with the 26 round-5 flags on too): after "the meeting was actually on 10-19-26" the card's
 * date went from 10-20 to null, and Create saved the day it was pressed (2026-10-21). The proposal dated it 10-19;
 * PRIOR_SENTENCE_FIX's date step (`ai/keep-filled-slots.ts`) then saw 10-19 and 10-20 as two incident dates.
 * CORRECTED_DATE_KEPT_ENABLED (`forms/corrected-incident-date.ts`). The test's chat word for word; the person is
 * invented ("Tess Varga", on no directory).
 */
const TESS: DirectoryRow = {
  id: "e-tess-varga",
  firstName: "Tess",
  lastName: "Varga",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const REQUEST = "create a CA for tess varga for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26";
const FIX = ["CORRECTED_DATE_KEPT_ENABLED"];
const REPORT = "QA's round-5 trace (8 Nov 2026), corrective-action-conversation-qa Q6 with production's flags: the corrected incident date was dropped, and Create saved today's date";

/** The card's date (the replay's card type does not list it). */
const cardDate = (thread: { proposal: unknown }) => (thread.proposal as { formDate?: string | null } | null)?.formDate ?? null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
  t.directory([...STAFF, TESS]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV8_CORRECTED_DATE_KEPT_CASES: ReplayCase[] = [
  {
    id: "nov8-corrected-date-kept-q6",
    title: "Q6: \"the meeting was actually on 10-19-26\", then a prior step's correction and \"no payroll deduct\": the card is dated 10-19 on every turn after, and Create saves 10-19",
    report: REPORT,
    // Changed on purpose (8 Nov 2026): fixed in production by CORRECTED_DATE_KEPT_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say(REQUEST);
      await thread.say("actually make it verbal");
      for (const turn of ["the meeting was actually on 10-19-26", "sorry, the verbal ca was on 9-2-26 not 9-1-26", "no payroll deduct"]) {
        const reply = await thread.say(turn);
        expect(cardDate(thread), `after "${turn}":\n${reply.content}`).toBe("2026-10-19");
      }
      t.draftWrites({ observation: "Observed:\nTess Varga did not attend the monthly meeting on October 19, 2026." });
      const id = await thread.create();
      expect(t.values(id).form_date, "the saved form's Date").toBe("2026-10-19");
    },
  },
  {
    id: "nov8-corrected-date-kept-prior-step-only",
    title: "negative: only the prior step's date is corrected (\"sorry, the verbal ca was on 9-2-26 not 9-1-26\"): the form keeps the meeting's date",
    report: `${REPORT} (the condition: a corrected prior step's date is never the form's)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say(REQUEST);
      const reply = await thread.say("sorry, the verbal ca was on 9-2-26 not 9-1-26");
      expect(cardDate(thread), `the prior step's date became the form's:\n${reply.content}`).not.toBe("2026-09-02");
    },
  },
  {
    id: "nov8-corrected-date-kept-two-incidents",
    title: "negative: two incidents and no correction (\"… late on 10/19 and again on 10/20\"): the flag changes nothing",
    report: `${REPORT} (the condition: only a correction settles the date)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a CA for tess varga, she was late on 10/19/26 and again on 10/20/26");
      expect(cardDate(thread), `a date was chosen without a correction:\n${reply.content}`).not.toBe("2026-10-19");
    },
  },
  {
    id: "nov8-date-question-kept-q6",
    title: "Q6 with only DATE_QUESTION_KEPT: \"the meeting was actually on 10-19-26\" leaves the date open, and the reply asks which date goes on the form",
    report: `${REPORT} (the step's own "Which date goes on the form?" was dropped, so nobody was asked)`,
    // Changed on purpose (8 Nov 2026): fixed in production by DATE_QUESTION_KEPT_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: ["DATE_QUESTION_KEPT_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say(REQUEST);
      await thread.say("actually make it verbal");
      const reply = await thread.say("the meeting was actually on 10-19-26");
      if (cardDate(thread)) return;
      expect(reply.content, `the date is open and nobody is asked:\n${reply.content}`).toMatch(/Which date goes on the form\?/);
    },
  },
];
