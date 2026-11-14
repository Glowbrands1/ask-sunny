import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * QA's Sunny gate, 6 Nov 2026: with CA_SALES_POLICY_ENABLED on, a bare "not late" was read as the
 * account, and the card drafted instead of saying "You haven't told me what happened yet". The
 * person is the pack's own (invented).
 */
const ASKS = /haven'?t told me what happened/i;
const FIX = ["CA_SALES_POLICY_ENABLED", "CA_ASKS_WHAT_HAPPENED_ENABLED", "OMISSION_IS_ACCOUNT_ENABLED", "BARE_NOT_DENIAL_ENABLED"];

export const NOV6_BARE_NOT_DENIAL_CASES: ReplayCase[] = [
  {
    id: "nov6-bare-not-denial-not-late",
    title: "\"…, not late\" is no account: the Corrective Action card asks what happened, with CA_SALES on",
    report: "QA's Sunny gate, 6 Nov 2026: omission-is-account control \"not late\" drafted with CA_SALES on",
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a corrective action for Rowan Kestrel, not late");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      if (t.loopActive?.()) {
        // Changed on purpose (loop-ON arm asserts meaning): QA, 14 Nov 2026: with AGENT_LOOP on the model words the reply; the flag-off arm keeps the exact wording.
        expect(reply.content, `does not ask what happened:\n${reply.content}`).toMatch(/what happened\?/i);
        expect(thread.proposal?.supportsInlineDraft, `drafted with no account (Create offered):\n${reply.content}`).toBe(false);
        return;
      }
      expect(reply.content, `drafted with no account:\n${reply.content}`).toMatch(ASKS);
    },
  },
  {
    id: "nov6-bare-not-denial-not-late-reply-matches-card",
    title: "the same, with REPLY_MATCHES_CARD on (the second gate): rule 5 keeps the ask, \"not late\" is no account",
    report: "QA's second Sunny gate, 6 Nov 2026: REPLY_MATCHES_CARD's rule 5 removed the ask that BARE_NOT_DENIAL put back",
    status: "fixed",
    fixFlags: [...FIX, "REPLY_MATCHES_CARD_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a corrective action for Rowan Kestrel, not late");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      if (t.loopActive?.()) {
        // Changed on purpose (loop-ON arm asserts meaning): QA, 14 Nov 2026: with AGENT_LOOP on the model words the reply; the flag-off arm keeps the exact wording.
        expect(reply.content, `does not ask what happened:\n${reply.content}`).toMatch(/what happened\?/i);
        expect(thread.proposal?.supportsInlineDraft, `drafted with no account (Create offered):\n${reply.content}`).toBe(false);
        return;
      }
      expect(reply.content, `drafted with no account:\n${reply.content}`).toMatch(ASKS);
    },
  },
];

