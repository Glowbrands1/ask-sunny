import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * NO ACCOUNT, NO POLICY "READ FROM THIS REQUEST" (QA's Sunny flip-9 live tester, 8 Nov 2026)
 * ============================================================================
 *
 * Live, with flip 7 (AS_YOU_SAID_MANAGER_WORDS, AS_YOU_SAID_APP_READ) and flip 9 (BARE_NOT_AFTER_REQUEST) on:
 * "ca for <A> not late" asked "You haven't told me what happened yet" — and the same card said
 * "**Policy:** Attendance — read from this request" for the fault the manager denied. The person is invented.
 *
 * production-flags.json does not list flips 7 and 9 yet, so the flags production runs are named in fixFlags.
 */
const ASKS = /haven'?t told me what happened/i;
const LIVE = [
  "AS_YOU_SAID_MANAGER_WORDS_ENABLED",
  "AS_YOU_SAID_APP_READ_ENABLED",
  "BARE_NOT_AFTER_REQUEST_ENABLED",
  "CA_ASKS_WHAT_HAPPENED_ENABLED",
  "BARE_NOT_DENIAL_ENABLED",
  "CA_SALES_POLICY_ENABLED",
];

async function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV8_NO_ACCOUNT_NO_APP_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov8-no-account-no-app-policy-ca-for-not-late",
    title: "\"ca for <A> not late\": the card asks what happened, and reads no policy from the request",
    report: "QA's Sunny flip-9 live tester, 8 Nov 2026 (1): \"Policy: Attendance — read from this request\" beside the ask",
    status: { open: "production (flips 7 and 9 not yet in the flags file): no ask, Attendance is read as the account" },
    fixFlags: [...LIVE, "NO_ACCOUNT_NO_APP_POLICY_ENABLED"],
    async run(t) {
      const thread = await start(t);
      const reply = await thread.say("ca for Rowan Kestrel not late");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
      expect(reply.content, `drafted with no account:\n${reply.content}`).toMatch(ASKS);
      expect(reply.content, `a policy read from a denied fault:\n${reply.content}`).not.toMatch(/read from this request/i);
    },
  },
  {
    id: "nov8-no-account-no-app-policy-late-opening-keeps-reading",
    title: "\"make me a CA for <A> for being late to opening this morning\": an account keeps the app's Policy line",
    report: "QA's Sunny flip-9 live tester, 8 Nov 2026 (1), its guard: nov7-as-you-said-app-read-late-opening",
    status: "fixed",
    fixFlags: [...LIVE, "NO_ACCOUNT_NO_APP_POLICY_ENABLED"],
    async run(t) {
      const thread = await start(t);
      const reply = await thread.say("make me a CA for Remy Calder for being late to opening this morning");
      expect(reply.content, `asked with an account:\n${reply.content}`).not.toMatch(ASKS);
      expect(reply.content, `the card has no Policy line:\n${reply.content}`).toMatch(/^\*\*Policy:\*\*[^\n]+$/m);
    },
  },
];
