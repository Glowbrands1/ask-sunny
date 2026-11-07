import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "CA FOR <A> NOT LATE" KEEPS ITS "WHAT HAPPENED" ASK WITH REPLY_MATCHES_CARD ON (Coding's bisect, 7 Nov 2026)
 * ============================================================================
 *
 * QA's live Sunny re-check (6 Nov 2026, (b)): "ca for <A> not late" is no account, so the Corrective Action card must
 * ask what happened (BARE_NOT_AFTER_REQUEST, #606). With REPLY_MATCHES_CARD (live) on, rule 5 dropped the ask: the
 * card's "Observation of Offense: <A> not late" led with the employee's name and so did not read as a bare denial.
 * BARE_NOT_NAME_LEAD_ENABLED (`ai/reply-matches-card.ts`).
 */

const ASKS = /haven'?t told me what happened/i;
const FIX = [
  "CA_SALES_POLICY_ENABLED",
  "CA_ASKS_WHAT_HAPPENED_ENABLED",
  "OMISSION_IS_ACCOUNT_ENABLED",
  "BARE_NOT_DENIAL_ENABLED",
  "BARE_NOT_AFTER_REQUEST_ENABLED",
  "REPLY_MATCHES_CARD_ENABLED",
  "BARE_NOT_NAME_LEAD_ENABLED",
];

export const NOV7_BARE_NOT_NAME_LEAD_CASES: ReplayCase[] = [
  {
    id: "nov7-bare-not-name-lead-ca-for-not-late",
    title: "\"ca for <A> not late\" with REPLY_MATCHES_CARD on: the card still asks what happened",
    report: "Coding's bisect, 7 Nov 2026 (nov6-bare-not-after-request-ca-for-not-late fails with REPLY_MATCHES_CARD on)",
    // Holds with the flags file as it stands on main (REPLY_MATCHES_CARD not listed there). With QA's flips (#609) the
    // production run is the live (b): BARE_NOT_AFTER_REQUEST is off there; the fix flags are the case.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("ca for Rowan Kestrel not late");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(reply.content, `drafted with no account:\n${reply.content}`).toMatch(ASKS);
    },
  },
  {
    id: "nov7-bare-not-name-lead-negative-late",
    title: "negative: \"ca for <A> she was late\" is an account, with the name lead set aside too: no ask",
    report: "Coding's bisect, 7 Nov 2026 (the fix's condition)",
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("ca for Rowan Kestrel she was late on 11-2-26");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa" });
      expect(reply.content, "an account was asked for anyway").not.toMatch(ASKS);
    },
  },
];
