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
 * (AS_YOU_SAID_MANAGER_WORDS_ENABLED, merged 6 Nov 2026) fixes it; those cases hold with its flag.
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
    /*
     * Changed on purpose (7 Nov 2026, ask-sunny #609): production-flags.json now has QA's flips (CA_SALES on), and
     * BARE_NOT_AFTER_REQUEST is off in production, so the pack's production run is QA's live (b): "not late" after
     * "ca for <A>" reads as an account and the card drafts "Policy: Attendance, as you said". The fix flags still draft
     * it while REPLY_MATCHES_CARD (live) is on: without it they hold. Reported to coding 2 and QA.
     */
    // Changed on purpose (8 Nov 2026): QA's flip 9 (00:59 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: ASKS_FIX,
    // fixStatus removed on purpose (7 Nov 2026): it was OPEN because the live REPLY_MATCHES_CARD dropped the ask
    // beside the card's "Observation of Offense: <A> not late"; BARE_NOT_AFTER_REQUEST's Observation half
    // (ask-sunny #624, keep-filled-slots.ts) keeps that line off the card, so the fix flags hold with it on.
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
      /*
       * Changed on purpose (7 Nov 2026, ask-sunny #609): with QA's flips in production-flags.json the pack now builds
       * the live line for this wording too, so it is open with production's flags (AS_YOU_SAID_MANAGER_WORDS is off
       * in production) and holds with the fix flag (#588).
       */
      // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
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
      // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
      status: "fixed",
      fixFlags: ["AS_YOU_SAID_MANAGER_WORDS_ENABLED"],
      // Holds with the fix flag since ask-sunny #588 (AS_YOU_SAID_MANAGER_WORDS_ENABLED) merged; with production's flags too since QA's flip 7 (7 Nov 2026).
      async run(t) {
        const thread = await start(t);
        t.slotsRead({ policyHeading: "Attendance" });
        const reply = await thread.say(text);
        expect(reply.content, `"as you said" for a policy never named:\n${reply.content}`).not.toMatch(ATTENDANCE_AS_YOU_SAID);
      },
    }),
  ),
];
