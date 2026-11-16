import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * PROGRESS WHILE THE LOOP WORKS (rebuild plan PR 6, item 5; Pau's speed idea via QA, 16 Nov 2026)
 * ============================================================================
 *
 * The chat shows a short status per tool step ("Looking up <name>…", "Building the card…") until the reply arrives,
 * in place of the empty wait. Loop users only, and only when the browser asks (`x-chat-progress: 1`); today's path and
 * everyone else get version 1 of the stream, unchanged. A status is display only: never in the reply, the chat
 * history or a trace. The stand-in takes real time per step (900 ms) so the turn passes the route's 2 s and streams.
 * Invented names (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Rebuild plan PR 6, item 5 (QA, 16 Nov 2026): progress statuses while the AI loop works";
const STEP_MS = 900;
/** The first step waits past the route's 2 s, so the stream has started when find_staff runs (earlier statuses collapse to the latest). */
const FIRST_STEP_MS = 2_300;
const wait = (ms = STEP_MS) => new Promise((resolve) => setTimeout(resolve, ms));

/** A Corrective Action card turn that takes about 4 s: find_staff, propose_form, then the reply. */
function slowCardTurn(t: ReplayContext) {
  t.loopModel!(loopStandIn(async (view): Promise<LoopDecision> => {
    await wait(view.results.length === 0 ? FIRST_STEP_MS : STEP_MS);
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12.", incident_date: "2026-11-12" } };
    return { text: "Here's the Corrective Action Form for **Remy Calder**." };
  }));
}

const traces = (t: ReplayContext) => JSON.stringify(t.rows?.("chat_traces") ?? []);

export const NOV16_AGENT_LOOP_PROGRESS_STATUS_CASES: ReplayCase[] = [
  {
    id: "nov16-pr6-progress-status-loop-user",
    title: "PR 6 item 5: a loop user's slow card turn streams \"Looking up remy calder…\" then \"Building the card…\" before the reply (version 2); the reply, the card, the history and the trace are the same as without statuses and hold no status",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);

      // The same turn without asking for statuses: version 1, as today.
      slowCardTurn(t);
      const plainThread = t.thread();
      const plain = await plainThread.say("ca for remy calder, she was 20 minutes late on 11/12");
      expect(plainThread.lastStreamVersion, "the turn did not stream (the stand-in was too fast)").toBe("1");
      expect(plainThread.lastProgress ?? []).toEqual([]);

      // Asking for statuses, as the chat screen does.
      slowCardTurn(t);
      const thread = t.thread();
      thread.askProgress!();
      const reply = await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
      expect(thread.lastStreamVersion).toBe("2");
      expect(thread.lastProgress).toEqual(expect.arrayContaining(["Looking up remy calder…", "Building the card…"]));
      expect(thread.lastProgress!.indexOf("Looking up remy calder…")).toBeLessThan(thread.lastProgress!.indexOf("Building the card…"));

      // Display only: the answer is the one version 1 gives, and no status is stored anywhere.
      expect(reply.content).toBe(plain.content);
      expect(reply.formProposal?.employeeName).toBe(plain.formProposal?.employeeName);
      expect(reply.formProposal?.templateKey).toBe(plain.formProposal?.templateKey);
      for (const status of thread.lastProgress!) {
        expect(reply.content).not.toContain(status);
        expect(JSON.stringify(thread.conversation ?? []), "a status reached the chat history").not.toContain(status);
        expect(traces(t), "a status reached a trace").not.toContain(status);
      }
    },
  },
  {
    id: "nov16-pr6-progress-status-unlisted-user",
    title: "PR 6 item 5: a manager not on AGENT_LOOP_USERS who asks for statuses gets today's path and never a version 2 stream or a status",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      if (t.loopOn?.()) {
        slowCardTurn(t);
        // The loop is on, but this manager is not on the list.
        vi.stubEnv("AGENT_LOOP_USERS", "someone-else@example.test");
      }
      try {
        const thread = t.thread();
        thread.askProgress!();
        await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
        expect(thread.lastStreamVersion ?? null).not.toBe("2");
        expect(thread.lastProgress ?? []).toEqual([]);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
];
