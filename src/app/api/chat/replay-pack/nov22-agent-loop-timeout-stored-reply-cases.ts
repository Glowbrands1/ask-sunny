import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * A TURN THAT RUNS OUT OF TIME STILL GETS A SAVED REPLY (port from Ask Bubbles 136d85d: its QA's live re-run, A1 follow-up)
 * ============================================================================
 *
 * Live, T4 "she is at <store>" ran 76 s and timed out with nothing done: HTTP 200, but the turn's answer was an
 * error that is never saved, so the chat had no reply for it (QA: managers saw blank replies). QA's call: a timed-out
 * turn returns a normal reply, saved with the chat, saying plainly in one sentence that nothing was changed, with no
 * promise about next time. The stand-in stalls; AI_MAIN_TIMEOUT_MS is set to its 5 s minimum for this case.
 */

/** QA's T4, with Sunny's place in place of the sibling app's store. */
const T4 = "she is at NE Kearney";

const REPORT = "QA's Bubbles live re-run (22 Nov 2026, A1): T4 (\"she is at <store>\") timed out after 76 s with no assistant message stored";

export const NOV22_AGENT_LOOP_TIMEOUT_STORED_REPLY_CASES: ReplayCase[] = [
  {
    id: "nov22-a1-timeout-is-a-saved-reply",
    title: "A1: a loop turn that runs out of time with nothing done (\"she is at NE Kearney\") answers with a normal reply saying nothing was changed — never an unsaved error",
    report: REPORT,
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const before = process.env.AI_MAIN_TIMEOUT_MS;
      process.env.AI_MAIN_TIMEOUT_MS = "5000";
      try {
        t.loopModel!(loopStandIn(() => ({ stall: true })));
        const reply = await t.thread().say(T4);
        expect(reply.content, "the timed-out turn has no reply").toMatch(/nothing was changed/i);
        expect(reply.content, "the reply promises it will work next time").not.toMatch(/try again|next time|in a moment/i);
      } finally {
        if (before === undefined) delete process.env.AI_MAIN_TIMEOUT_MS;
        else process.env.AI_MAIN_TIMEOUT_MS = before;
      }
    },
  },
];
