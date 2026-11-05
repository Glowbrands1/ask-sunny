import { endsAsSentence, KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * EVERY EARLIER REPLY THAT ENDED ON "I CAN PREPARE:" (sf-b6's siblings)
 * ============================================================================
 *
 * The 9 production replies before sf-b6 whose stored text ends on the form
 * picker's heading (`formOpportunityLead`), found in the sibling app's chat
 * history on 5 Nov 2026. This app has the same code, so the
 * same chats are replayed here with this app's fixtures (salon, not store).
 * The answering model's text is as stored, without the
 * heading code added after it; the manager's words are as written. "test
 * employee" is QA's own placeholder; the 2 Nov employee is the invented name
 * already used for that conversation (`nov2-p5-name-claims`).
 *
 * The invariant is `endsAsSentence`: a reply ends on the heading only when
 * the picker's cards come with it, and never while a form is in progress.
 *
 *   26 Oct (5): a first turn, nothing in progress; the cards come with the
 *   heading. Holds with production's flags.
 *   2 Nov (4): a draft open; the heading came with no card the manager could
 *   use. Holds since OPEN_FORM_NO_SELECTION_ENABLED went on (3 Nov).
 */

const REPORT = "\"Reply ended mid-sentence: 'Based on what you've described, I can prepare:'\" (sf-b6, QA, 5 Nov 2026); the earlier replies with the same ending, from the sibling app's chat history; the same mechanism here.";

/** 26 Oct 2026: QA's first-turn Corrective Action requests, each a new chat. */
const OCT26: readonly { readonly id: string; readonly said: string; readonly model: string }[] = [
  {
    id: "pk-1026-a",
    said: "Ca for test employee at kearney, late today, previous coaching verbal 6/25 and written 7/28",
    model:
      "I can't write the form itself here — only create it as a real record — but I can help you get it started.\n\nA few things before that:\n\n- **Salon check:** Kearney, NE is a salon you cover, which is verified. Good.\n- **Progression:** You're telling me there's a verbal coaching on file from 6/25 and a written coaching from 7/28, plus a late arrival today (10/25).",
  },
  {
    id: "pk-1026-b",
    said: "ca for test employee at kearney, late today, previous coaching verbal 6/25",
    model:
      "I can draft a Coaching Form for this — let me make sure I have it right first.\n\nA couple of things to sort out:\n\n- **\"ca\"** — I'm reading this as a request for a Corrective Action Form. Confirm that's what you want.\n- **Employee name** — you wrote \"test employee.\" I'll use that name exactly as given unless you tell me otherwise.",
  },
  {
    id: "pk-1026-c",
    said: "Ca for test employee at kearney, late today, previous coaching verbal 6/25",
    model:
      "I don't have a roster record for \"test employee,\" so I can't verify a title or employment status for that name — I'll use the name exactly as you typed it. The salon is verified as Kearney, NE.\n\nA late arrival today plus a prior verbal coaching from 6/25 is a reasonable basis to move to a Corrective Action Form — that's an observed pattern, not just a number.",
  },
  {
    id: "pk-1026-d",
    said: "ca for test employee at kearney, late today. previous coaching: verbal 6/25 and written 7/28",
    model:
      "Got it — Corrective Action for late arrival today (2026-10-25), with prior Verbal Coaching on 6/25/2026 and Written Coaching on 7/28/2026 already on file for \"test employee\" at Kearney, NE.\n\nThat's a reasonable progression to document — verbal, then written, now a corrective action for a continued attendance issue.",
  },
  {
    id: "pk-1026-e",
    said: "Ca for test employee at kearney, late today. Previous coaching: verbal 6/25 and written 7/28",
    model:
      "I can't draft the write-up itself here, but a Corrective Action Form is the right template for a pattern after verbal (6/25) and written (7/28) coaching, and you can create it in this conversation.\n\nA couple of notes before you do:\n\n- I have no VERIFIED RECORDS for an employee named \"test employee\" at Kearney — I can't confirm title, status or salon assignment for them.",
  },
];

/** 2 Nov 2026: the name corrections on an open Corrective Action draft (the conversation in `nov2-p5-name-claims`). */
const NOV2: readonly { readonly id: string; readonly said: string; readonly model: string }[] = [
  {
    id: "pk-1102-a",
    said: "fix her last name ramos",
    model: "**Nothing on the form has changed yet.**\n\nSay **make that update** and I'll write it into the draft, or edit the card and press **Save changes**.",
  },
  {
    id: "pk-1102-b",
    said: "make that update",
    model:
      "Got it — the employee name on the draft now reads **Delia Garza Ramos**. Everything else on the card stays as it was.\n\nReview the card and press **Save changes**, then **Finalize** when you're ready to issue it.",
  },
  {
    id: "pk-1102-c",
    said: "under the employee line the name is supposed to be delia gazra ramos",
    model:
      "Double-check that spelling on the card before you press **Save changes** — want me to confirm it's \"Garza\" with a Z after the R, or \"Gazra\" as you just typed it?",
  },
  {
    id: "pk-1102-d",
    said: "make that change to Delia Carza Ramos",
    model:
      "To confirm: you've now given me three different spellings in a row — Ramos, Gazra Ramos, and now \"Carza Ramos.\" Please tell me the exact correct spelling once, and I'll update the Employee Name field on the draft to match it exactly.",
  },
];

export const NOV5_PICKER_HEADING_CASES: readonly ReplayCase[] = [
  ...OCT26.map(
    (entry): ReplayCase => ({
      id: entry.id,
      title: `a first-turn request (26 Oct): the picker's heading comes with its cards — "${entry.said}"`,
      report: REPORT,
      status: "fixed",
      async run(t) {
        t.directory(STAFF);
        t.as("salon_director", KEARNEY);
        t.modelSays(entry.model);
        const reply = await t.thread().say(entry.said);
        endsAsSentence(reply, entry.said, false);
      },
    }),
  ),
  ...NOV2.map(
    (entry): ReplayCase => ({
      id: entry.id,
      title: `with a draft open (2 Nov): no picker and no heading — "${entry.said}"`,
      report: REPORT,
      // Fixed in production: OPEN_FORM_NO_SELECTION_ENABLED (QA, 3 Nov 2026, 04:20 UTC).
      status: "fixed",
        async run(t) {
        t.directory(STAFF);
        t.as("salon_director", KEARNEY);
        const thread = t.thread();
        await thread.say("i have an employee, Delia Garza Ramso that needs a corrective action form with a customer complaint");
        await thread.say("verbal warning, no payroll deduct, part-time team member,");
        t.draftWrites({});
        await thread.create();
        t.modelSays(entry.model);
        const reply = await thread.say(entry.said);
        endsAsSentence(reply, entry.said, true);
      },
    }),
  ),
];
