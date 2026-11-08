import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * sf-s38 (QA's morning scan, 8 Nov 2026; Sunny production, 7 Nov 16:14–16:23Z)
 * ============================================================================
 *
 * The manager's words, the employee swapped for an invented one (the pack's STAFF):
 *   T1 (sent twice) "make me an CA for <A> missing her saturday and sunday shifts due to wanting to go home for the
 *      weekend but failed to communicate proporley" → the Corrective Action card;
 *   (1) "create it" and "create  the draft" each sent the same proposal text again; the draft was only made by the
 *       card's button;
 *   (2) "this proposal is out od fate" became "**Observation of Offense:** this proposal is out od fate";
 *   (3) Create refused the card as out of date for "<A> missing": that is coding 4's reader cut (ACCOUNT_VERB_NOT_A_NAME,
 *       its own cases), not these flags.
 * Changed on purpose (coding 2, 8 Nov 2026; QA parked CARD_NAME_THEN_WORDS_CURRENT, so these cases run without it): the
 * Create step of (2) is its own case, open until the reader cut is on main (Create is refused before the draft is made).
 * Still so on main 144c26b5 with production's flags, flip 9 and round 4.
 */
const T1 = "make me an CA for Rowan Kestrel missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";
const FIX = ["CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "CARD_COMPLAINT_NOT_ACCOUNT_ENABLED"];
const PROPOSAL_TEXT = /I'll draft a \*\*Corrective Action Form\*\* for \*\*Rowan Kestrel\*\*/;
const PRESS = /press \*\*Create draft\*\* on the card/i;
const REPORT = "QA's sf-s38, 8 Nov 2026 (Sunny production, conv f5e4e29a)";

async function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T16:14:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(T1);
  await thread.say(T1);
  expect(thread.proposal, "no Corrective Action card for Rowan Kestrel").toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
  return thread;
}

export const NOV8_SF_S38_CARD_META_CASES: ReplayCase[] = [
  {
    id: "nov8-sf-s38-create-it",
    title: "sf-s38 (1): \"create it\" and \"create  the draft\" say to press Create draft, never the same proposal text again",
    report: REPORT,
    status: { open: "each re-sends the same proposal text" },
    fixFlags: FIX,
    async run(t) {
      const thread = await start(t);
      for (const said of ["create it", "create  the draft"]) {
        const reply = await thread.say(said);
        expect(reply.content, `"${said}" sent the proposal again:\n${reply.content}`).not.toMatch(PROPOSAL_TEXT);
        expect(reply.content, `"${said}" does not say how to create it:\n${reply.content}`).toMatch(PRESS);
        expect(reply.formProposal, `"${said}" lost the card`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
      }
    },
  },
  {
    id: "nov8-sf-s38-out-od-fate",
    title: "sf-s38 (2): \"this proposal is out od fate\" asks what to change, and is never the Observation",
    report: REPORT,
    status: { open: "\"this proposal is out od fate\" becomes the card's Observation of Offense" },
    fixFlags: FIX,
    async run(t) {
      const thread = await start(t);
      await thread.say("create it");
      const reply = await thread.say("this proposal is out od fate");
      expect(reply.content, `the complaint is the Observation:\n${reply.content}`).not.toMatch(/out od fate/i);
      expect(reply.content, `the complaint is not acknowledged:\n${reply.content}`).toMatch(/What on the proposal is out of date\?/);
      expect(reply.formProposal, "the card was lost").toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
    },
  },
  {
    id: "nov8-sf-s38-out-od-fate-create",
    title: "sf-s38 (2) at Create: after \"this proposal is out od fate\", the draft keeps the account and never the complaint",
    report: REPORT,
    status: { open: "\"this proposal is out od fate\" becomes the card's Observation of Offense" },
    fixFlags: FIX,
    // Create refuses this card as out of date for "<A> missing" until coding 4's reader cut (ACCOUNT_VERB_NOT_A_NAME) is
    // on main; then this holds with FIX and `fixStatus` goes. The draft route's filter is unit-tested meanwhile
    // (`ai/card-meta-turn.test.ts`, withoutCardMetaTurns).
    fixStatus: { open: "Create refuses the card as out of date for \"Rowan Kestrel missing\" (the reader cut, coding 4)" },
    async run(t) {
      const thread = await start(t);
      await thread.say("create it");
      await thread.say("this proposal is out od fate");
      t.draftWrites({ observation: "Observed:\nRowan Kestrel missed her Saturday and Sunday shifts and did not communicate it." });
      const id = await thread.create();
      expect(t.values(id).observation ?? "", "the account was lost at Create").toMatch(/saturday/i);
      expect(t.values(id).observation ?? "", "the complaint reached the draft").not.toMatch(/out od fate|proposal/i);
    },
  },
];
