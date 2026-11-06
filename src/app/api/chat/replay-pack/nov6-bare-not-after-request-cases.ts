import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * QA's live Sunny re-check, 6 Nov 2026 (real model, production with the 7 flip flags; the person is invented):
 *   (a) "create a corrective action for <A>, not late": asks what happened, but the card also says
 *       "Policy: Attendance, as you said." (the manager never named Attendance);
 *   (b) "ca for <A> not late": no ask at all, the card cites Attendance with "Observation of Offense: <A> not late";
 *   S2a "Write me a CA for <B> for failing to complete opening duties. <B> did not complete daily cleaning
 *       duties. on november 2, 2026": "Policy: Attendance, as you said." (expected Other).
 *
 * The "as you said" line is the model's policy heading written back onto the turn as the app's own
 * "Policy reference: …" line, which the policy reader took as the manager's words; ask-sunny #588
 * (AS_YOU_SAID_MANAGER_WORDS_ENABLED, open) fixes it. Those cases are OPEN until it merges (fixStatus).
 * (b)'s missing ask is BARE_NOT_AFTER_REQUEST_ENABLED's: "not late" after "ca for <A>" in the same clause.
 */
const ASKS = /haven'?t told me what happened/i;
const ATTENDANCE_AS_YOU_SAID = /\*\*Policy:\*\* Attendance, as you said/i;
const ASKS_FIX = ["CA_SALES_POLICY_ENABLED", "CA_ASKS_WHAT_HAPPENED_ENABLED", "OMISSION_IS_ACCOUNT_ENABLED", "BARE_NOT_DENIAL_ENABLED", "BARE_NOT_AFTER_REQUEST_ENABLED"];

async function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const AS_YOU_SAID: { key: string; text: string }[] = [
  { key: "a-comma-not-late", text: "create a corrective action for Rowan Kestrel, not late" },
  { key: "b-ca-for-not-late", text: "ca for Rowan Kestrel not late" },
  {
    key: "s2a-opening-cleaning-duties",
    text: "Write me a CA for Rowan Kestrel for failing to complete opening duties. Rowan Kestrel did not complete daily cleaning duties. on november 2, 2026",
  },
];

export const NOV6_BARE_NOT_AFTER_REQUEST_CASES: ReplayCase[] = [
  {
    id: "nov6-bare-not-after-request-ca-for-not-late",
    title: "(b) \"ca for <A> not late\": no account, so the Corrective Action card asks what happened",
    report: "QA's live Sunny re-check, 6 Nov 2026 (b): no ask, and the Observation is \"<A> not late\"",
    // Holds with the pack's production flags (recorded before the flip, CA_SALES off); with the flip's CA_SALES path on and
    // BARE_NOT_AFTER_REQUEST off, "not late" after "ca for <A>" read as an account and the ask was lost (QA's live (b)).
    status: "fixed",
    fixFlags: ASKS_FIX,
    async run(t) {
      const thread = await start(t);
      const reply = await thread.say("ca for Rowan Kestrel not late");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(reply.content, `drafted with no account:\n${reply.content}`).toMatch(ASKS);
    },
  },
  {
    id: "nov6-bare-not-after-request-negative-late",
    title: "negative: \"ca for <A> she was late\" is an account: no ask",
    report: "QA, 6 Nov 2026 (BARE_NOT_AFTER_REQUEST's condition)",
    status: "fixed",
    fixFlags: ASKS_FIX,
    async run(t) {
      const thread = await start(t);
      const reply = await thread.say("ca for Rowan Kestrel she was late on 11/2");
      expect(reply.content, `asked although she was late:\n${reply.content}`).not.toMatch(ASKS);
    },
  },
  ...AS_YOU_SAID.map(
    ({ key, text }): ReplayCase => key.startsWith("s2a") ? {
      id: `nov6-as-you-said-attendance-${key}`,
      title: `S2a guard: "${text.slice(0, 60)}…" with the reader's heading "Attendance": never "Attendance, as you said"`,
      report: "QA's live Sunny re-check, 6 Nov 2026 (S2a): \"Policy: Attendance, as you said.\" for unfinished duties",
      // A GUARD: the pack's stand-ins do not build the live line for this wording (it holds off and on); #588's unit test
      // proves the line from the app's "Policy reference" line, and this case keeps the wording in the pack.
      status: "fixed",
      fixFlags: ["AS_YOU_SAID_MANAGER_WORDS_ENABLED"],
      async run(t) {
        const thread = await start(t);
        t.slotsRead({ policyHeading: "Attendance" });
        const reply = await thread.say(text);
        expect(reply.content, `"as you said" for a policy never named:\n${reply.content}`).not.toMatch(ATTENDANCE_AS_YOU_SAID);
      },
    } : ({
      id: `nov6-as-you-said-attendance-${key}`,
      title: `"${text.slice(0, 60)}…" with the reader's heading "Attendance": never "Attendance, as you said"`,
      report: "QA's live Sunny re-check, 6 Nov 2026: \"Policy: Attendance, as you said.\" though the manager never named Attendance",
      status: { open: "the reader's heading is written back as the app's own \"Policy reference\" line and read as the manager naming Attendance" },
      fixFlags: ["AS_YOU_SAID_MANAGER_WORDS_ENABLED"],
      fixStatus: { open: "fixed by ask-sunny #588 (AS_YOU_SAID_MANAGER_WORDS_ENABLED), not merged yet: drop this fixStatus when it merges" },
      async run(t) {
        const thread = await start(t);
        t.slotsRead({ policyHeading: "Attendance" });
        const reply = await thread.say(text);
        expect(reply.content, `"as you said" for a policy never named:\n${reply.content}`).not.toMatch(ATTENDANCE_AS_YOU_SAID);
      },
    }),
  ),
];
