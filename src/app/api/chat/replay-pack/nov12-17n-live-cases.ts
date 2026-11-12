import { expect, vi } from "vitest";

import { KEARNEY, STAFF, noClaimWithoutUpdate, type DirectoryRow, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";
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

// Item 2, QA's own test wording (the name invented).
const WYNNE: DirectoryRow = {
  id: "e-wynne-larkspur-17n",
  firstName: "Wynne",
  lastName: "Larkspur",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
// 4a, the manager's words ("the register" is the same at a salon), the employee invented.
const CLOSE_REGISTER = "create a corrective action for Remy Calder, he forgot to clsoe the register at night on 11/10";
const REVIEW_TURN =
  "create a coaching form for Wynne Larkspur. Here is a customer review: 'Went in on Saturday and the girl at the counter ignored me for 10 minutes and was rude when I finally asked for help. One star.'";

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
  {
    id: "nov12-17n-2-pasted-customer-review-asks-what-you-saw",
    title: "item 2: a pasted customer review is not the account, and the reply says so and asks what the manager saw",
    report: REPORT,
    status: { open: "the review is dropped silently: nothing asks what the manager saw" },
    fixFlags: ["PASTED_REVIEW_ASKS_WHAT_YOU_SAW_ENABLED"],
    async run(t) {
      const thread = start(t);
      t.directory([...STAFF, WYNNE]);
      const reply = await thread.say(REVIEW_TURN);
      expect(reply.content, reply.content).toMatch(/review/i);
      expect(reply.content, reply.content).toMatch(/What did you see happen\?/);
      expect(reply.content, reply.content).not.toMatch(/Everything I need is here/i);
    },
  },
  {
    id: "nov12-17n-4a-close-register-asks-which-policy",
    title: "4a: \"he forgot to clsoe the register at night on 11/10\" cites no policy and asks which applies; the Issue keeps \"clsoe\"",
    report: REPORT,
    status: { open: "no Policy line and no question" },
    fixFlags: ["CA_NO_POLICY_ASKS_WHICH_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(CLOSE_REGISTER);
      // QA's ruling: the Issue keeps the manager's words as typed, and no policy is picked for them.
      expect(reply.content, reply.content).toMatch(/clsoe the register/);
      expect(reply.content, reply.content).not.toMatch(/\*\*Policy:\*\*/);
      expect(reply.content, reply.content).toMatch(/\*\*Which policy applies\?\*\*/);
      const answered = await thread.say("standards of conduct");
      expect(answered.content, answered.content).toMatch(/\*\*Policy:\*\* Standards of Conduct\b/);
    },
  },
];
