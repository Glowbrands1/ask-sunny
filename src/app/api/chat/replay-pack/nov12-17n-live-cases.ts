import { expect, vi } from "vitest";

import { KEARNEY, STAFF, noClaimWithoutUpdate, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";
import { patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * QA's BUBBLES 17n LIVE TEST (12 Nov 2026), PORTED
 * ============================================================================
 *
 * The sibling app's managers' wording ("the store" read as "the salon" here), the employee invented (on the pack's
 * roster). The same readers run here.
 */
const REPORT = "QA's Bubbles 17n live test, 12 Nov 2026 (ported)";

function start(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV12_17N_LIVE_CASES: ReplayCase[] = [
  {
    id: "nov12-17n-4b-late-to-reoepn-is-late-opening",
    title: "4b: \"he was late to reoepn the salon on 11/9\" cites Late Opening, not Attendance from \"late\"",
    report: REPORT,
    status: { open: "the card cites Attendance from \"late\"" },
    fixFlags: ["REOPEN_IS_OPENING_ENABLED"],
    async run(t) {
      const reply = await start(t).say("create a corrective action for Remy Calder, he was late to reoepn the salon on 11/9");
      expect(reply.content, reply.content).toMatch(/\*\*Policy:\*\* Late Opening\b/);
      expect(reply.content, reply.content).not.toMatch(/\*\*Policy:\*\* Attendance\b/);
    },
  },
  {
    id: "nov12-17n-4c-bare-form-name-asks-what",
    title: "4c: a pasted bare \"Corrective Action Form\" asks what the manager needs, with no empty card",
    report: REPORT,
    status: { open: "\"Who is this form for? Tell me the employee's full name.\" over an empty card" },
    fixFlags: ["BARE_FORM_NAME_ASKS_WHAT_ENABLED"],
    async run(t) {
      const reply = await start(t).say("Corrective Action Form");
      expect(reply.content, reply.content).toMatch(/What do you need on the \*\*Corrective Action Form\*\*/);
      expect(reply.formProposal, "an empty card is shown").toBeUndefined();
    },
  },
  {
    id: "nov12-17n-3-this-form-is-about-cash-handling",
    title: "item 3: \"this form is about cash handling\" on an open Coaching draft rewrites its Details, not \"I haven't changed …\"",
    report: REPORT,
    /*
     * A guard, not a port: Ask Bubbles' bug (its THIS_FORM_IS_ABOUT_ENABLED) is not in this app. Here the turn goes to the
     * old path and its revision rewrites the Details from "this form is about cash handling" as it stands, with or
     * without the reader's own edit (checked with and without the patch-reader script, 12 Nov 2026).
     */
    status: "fixed",
    async run(t) {
      const thread = start(t);
      await thread.say("create a coaching form for Remy Calder, he was on his phone on the floor on 11/10");
      t.draftWrites({ coaching_details: "Observed:\nRemy Calder was on his phone on the salon floor." });
      const id = await thread.create();
      const CASH = "Observed:\nRemy Calder did not follow cash handling procedures.\n\nExpectation:\nRemy is expected to follow cash handling procedures.";
      t.patchReads!({
        "this form is about cash handling": patch("this_form", [
          { field: "coaching_details", value: CASH, how: "replace", evidence: "cash handling" },
        ]) as never,
      });
      t.revisionWrites({ coaching_details: CASH });
      const reply = await thread.say("this form is about cash handling");
      noClaimWithoutUpdate(reply);
      expect(reply.content, reply.content).not.toMatch(/haven'?t changed/i);
      expect(t.values(id).coaching_details, "the Details are now about cash handling").toMatch(/cash handling/i);
    },
  },
];
