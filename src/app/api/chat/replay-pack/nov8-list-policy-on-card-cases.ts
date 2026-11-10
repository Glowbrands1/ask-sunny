import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "PLEASE LIST THE POLICY" WITH ONLY A CARD OPEN (QA, 8 Nov 2026, option b)
 * ============================================================================
 *
 * No draft yet, so EDIT_POLICY_ASK cannot write the line. With LIST_POLICY_IS_EDIT_ENABLED the turn stays a card turn:
 * the card is proposed again, never a general policy answer; a card with its own manual policy line shows it, and one
 * without says the policy is listed on the draft at Create. Guard: a real question is still answered. The person is
 * invented (the pack's STAFF).
 */
const FLAGS = ["QUESTION_NOT_FORM_ENABLED", "EDIT_POLICY_ASK_ENABLED", "LIST_POLICY_IS_EDIT_ENABLED"];
const CA_REQUEST = "create a corrective action for Rowan Kestrel, she was 30 minutes late to her shift on 10/31";
const COACHING_REQUEST = "create a coaching form for Rowan Kestrel, she was 30 minutes late to her shift on 10/31";
const LISTED_AT_CREATE = /list the manual's policy that matches what happened on the draft when you create it/i;
const GROUNDED = /grounded answer/i;
const MANUAL_LINE = /JBA Policy Manual p\.\s?\d+/;

async function start(t: ReplayContext, request: string, templateKey: string) {
  vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(request);
  expect(thread.proposal, `no ${templateKey} card for Rowan Kestrel`).toMatchObject({ templateKey, employeeName: "Rowan Kestrel" });
  return thread;
}

export const NOV8_LIST_POLICY_ON_CARD_CASES: ReplayCase[] = [
  {
    id: "nov8-list-policy-on-card-coaching",
    title: "Coaching card open, with an account: \"please list the policy\" keeps the card, which shows its manual policy line",
    report: "QA, 8 Nov 2026: \"please list the policy\" with a card open is answered as a general policy question",
    // Changed on purpose (8 Nov 2026): fixed in production by LIST_POLICY_IS_EDIT_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      const thread = await start(t, COACHING_REQUEST, "coaching");
      const reply = await thread.say("please list the policy");
      expect(reply.content, `answered as a policy question:\n${reply.content}`).not.toMatch(GROUNDED);
      expect(reply.formProposal, `no card:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      expect(reply.content, `the card shows no manual policy line:\n${reply.content}`).toMatch(MANUAL_LINE);
      expect(reply.content, "a second policy sentence beside the card's own line").not.toMatch(LISTED_AT_CREATE);
      t.draftWrites({ coaching_details: "Observed:\nOn 10/31/2026 Rowan Kestrel was 30 minutes late to her shift." });
      const id = await thread.create();
      expect(t.values(id).coaching_details ?? "", "the account was lost at Create").toMatch(/late/i);
      expect(t.values(id).coaching_details ?? "", "the ask is drafted as the account").not.toMatch(/list the policy/i);
    },
  },
  {
    id: "nov8-list-policy-on-card-no-account",
    title: "Coaching card open, no account yet: \"please list the policy\" keeps the card and says the policy goes on the draft at Create",
    report: "QA, 8 Nov 2026: \"please list the policy\" with a card open is answered as a general policy question",
    // Changed on purpose (8 Nov 2026): fixed in production by LIST_POLICY_IS_EDIT_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      const thread = await start(t, "create a coaching form for Rowan Kestrel", "coaching");
      const reply = await thread.say("please list the policy");
      expect(reply.content, `answered as a policy question:\n${reply.content}`).not.toMatch(GROUNDED);
      expect(reply.formProposal, `no card:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      expect(reply.content, `a policy line with no account:\n${reply.content}`).not.toMatch(MANUAL_LINE);
      expect(reply.content, `the card does not say where the policy goes:\n${reply.content}`).toMatch(LISTED_AT_CREATE);
    },
  },
  {
    id: "nov8-list-policy-on-card-ca",
    title: "CA card open: \"please list the policy\" keeps the card with its manual policy line, and Create keeps the account",
    report: "QA, 8 Nov 2026: \"please list the policy\" with a card open is answered as a general policy question",
    // Already right in production (the CA card path keeps the turn); a guard that the flag keeps it so, through Create.
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      const thread = await start(t, CA_REQUEST, "dpoa");
      const reply = await thread.say("please list the policy");
      expect(reply.content, `answered as a policy question:\n${reply.content}`).not.toMatch(GROUNDED);
      expect(reply.formProposal, `no card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
      expect(reply.content, `the card shows no manual policy line:\n${reply.content}`).toMatch(MANUAL_LINE);
      expect(reply.content, "a second policy sentence beside the card's own line").not.toMatch(LISTED_AT_CREATE);
      t.draftWrites({ observation: "Observed:\nOn 10/31/2026 Rowan Kestrel was 30 minutes late to her shift." });
      const id = await thread.create();
      expect(t.values(id).observation ?? "", "the account was lost at Create").toMatch(/late/i);
    },
  },
  {
    id: "nov8-list-policy-on-card-question-still-answered",
    title: "card open: \"what policy covers lateness?\" is still answered as a question",
    report: "QA, 8 Nov 2026: LIST_POLICY_IS_EDIT's guard",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      const thread = await start(t, COACHING_REQUEST, "coaching");
      const reply = await thread.say("what policy covers lateness?");
      expect(reply.content, `the question was not answered:\n${reply.content}`).toMatch(GROUNDED);
      expect(reply.content, "a question read as the ask").not.toMatch(LISTED_AT_CREATE);
    },
  },
];
