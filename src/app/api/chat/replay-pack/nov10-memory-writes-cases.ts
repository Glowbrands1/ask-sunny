import { expect } from "vitest";

import { KEARNEY, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE TURN'S MEMORY WRITES (QA, 10 Nov 2026, before CHAT_PARALLEL_LOADS can be flipped)
 * ============================================================================
 *
 * CHAT_PARALLEL_LOADS starts the two loads that write (recalled memory, the long-context summary) earlier. QA: the
 * pack must show they write exactly as often as before (memoff vs memloads, the record's `rows`). No case wrote
 * either table, so the comparison was 0 = 0. This one does both: a "remember that …" turn (CHAT_MEMORY: one
 * user_memory row) and a conversation past the long-context budget (LONG_CONTEXT, on in production: one
 * chat_context_summaries row once the summary model answers). The history the turn is given is its last 20 messages,
 * so the window is passed by its 6000-token budget: long notes pasted into the chat.
 */
/** About 870 tokens (under the 4000-character limit): a long note, as a manager pastes one. */
const NOTE = (turn: number) => `here are my notes from shift ${turn}: ${"the front desk was covered and the towels were restocked. ".repeat(60)}`;
const SUMMARY = "Earlier: the manager asked about opening times and shift cover at the salon.";

export const NOV10_MEMORY_WRITES_CASES: ReplayCase[] = [
  {
    id: "nov10-memory-and-summary-writes",
    title: "\"remember that my default salon is Kearney\", then long notes past the long-context budget: one memory row and one saved summary",
    report: "QA, 10 Nov 2026: CHAT_PARALLEL_LOADS must write exactly as often as before; the pack had no turn that wrote",
    status: "fixed",
    fixFlags: ["CHAT_MEMORY_ENABLED"],
    async run(t) {
      t.as("salon_director", KEARNEY);
      t.summaryWrites!(SUMMARY);
      const thread = t.thread();
      await thread.say("remember that my default salon is Kearney");
      const memory = process.env.CHAT_MEMORY_ENABLED === "true";
      expect(t.rows!("user_memory"), "the memory written").toHaveLength(memory ? 1 : 0);
      // Eight long notes: past the 6000-token budget, so the older ones are summarized.
      for (let turn = 1; turn <= 8; turn += 1) await thread.say(NOTE(turn));
      // The save is not awaited by the turn.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const summaries = t.rows!("chat_context_summaries");
      expect(summaries, "the summary saved").toHaveLength(1);
      expect(summaries[0]?.summary).toBe(SUMMARY);
      expect(t.rows!("user_memory"), "no memory written by a turn that asked nothing to be remembered").toHaveLength(memory ? 1 : 0);
    },
  },
];
