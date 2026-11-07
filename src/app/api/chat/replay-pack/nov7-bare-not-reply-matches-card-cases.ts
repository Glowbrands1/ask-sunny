import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * Coding's bisect (7 Nov 2026, bringing production-flags.json up to date, #609): with the live
 * REPLY_MATCHES_CARD_ENABLED, "ca for <A> not late" lost BARE_NOT_AFTER_REQUEST's ask again. The card's
 * Observation of Offense was "<A> not late", and REPLY_MATCHES_CARD's rule 5 (an account on the card: never
 * "You haven't told me what happened yet") took the ask off. BARE_NOT_AFTER_REQUEST_ENABLED now also keeps a
 * sentence that only says what did not happen out of the Observation. REPLY_MATCHES_CARD is in fixFlags so this
 * holds before production-flags.json lists it. The person is the pack's invented Rowan Kestrel.
 */
const ASKS = /haven'?t told me what happened/i;
const FIX = [
  "CA_SALES_POLICY_ENABLED",
  "CA_ASKS_WHAT_HAPPENED_ENABLED",
  "OMISSION_IS_ACCOUNT_ENABLED",
  "BARE_NOT_DENIAL_ENABLED",
  "BARE_NOT_AFTER_REQUEST_ENABLED",
  "REPLY_MATCHES_CARD_ENABLED",
];
const REPORT = "Coding, 7 Nov 2026: BARE_NOT_AFTER_REQUEST's ask lost under the live REPLY_MATCHES_CARD (bisected)";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function observationLine(content: string): string {
  return content.split("\n").find((line) => /\*\*Observation of Offense:?\*\*/i.test(line)) ?? "";
}

export const NOV7_BARE_NOT_REPLY_MATCHES_CARD_CASES: ReplayCase[] = [
  {
    id: "nov7-bare-not-reply-matches-card-ca-for-not-late",
    title: "\"ca for <A> not late\" with REPLY_MATCHES_CARD on: the card asks what happened, and \"<A> not late\" is no Observation",
    report: REPORT,
    // With production's flags (BARE_NOT_AFTER_REQUEST off) the card's Observation is still "<A> not late".
    // Changed on purpose (8 Nov 2026): QA's flip 9 (00:59 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("ca for Rowan Kestrel not late");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(reply.content, `drafted with no account:\n${reply.content}`).toMatch(ASKS);
      expect(observationLine(reply.content), `a denial is the Observation:\n${reply.content}`).not.toMatch(/not late/i);
    },
  },
  {
    id: "nov7-bare-not-reply-matches-card-negative-late",
    title: "negative: \"ca for <A> she was late on 11/2\" with REPLY_MATCHES_CARD on: an account, no ask, and the Observation keeps it",
    report: `${REPORT} (the condition)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("ca for Rowan Kestrel she was late on 11/2");
      expect(reply.content, `asked although she was late:\n${reply.content}`).not.toMatch(ASKS);
    },
  },
];
