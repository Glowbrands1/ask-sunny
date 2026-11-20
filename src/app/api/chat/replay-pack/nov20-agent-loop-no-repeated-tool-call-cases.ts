import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * NO REPEATED IDENTICAL TOOL CALL IN ONE TURN (QA's f047, 20 Nov 2026)
 * ============================================================================
 *
 * A 27 s reply made the same tool call with the same input more than once. Within one loop turn, a call to a tool that
 * only reads, with the same input as an earlier call, returns the earlier result instead of running again; a tool that
 * writes always runs. These cases count the knowledge searches the turn really ran (`t.searches()`).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's f047 (20 Nov 2026): a 27 s reply made the same tool call with the same input more than once";
const QUESTION = "what is the procedure for cleaning the spray tan booth at close?";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T12:30:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** The model searches with `queries`, one per step, then answers. */
function searches(queries: readonly string[]) {
  return loopStandIn((view): LoopDecision => {
    const done = view.results.filter((result) => result.tool === "search_knowledge").length;
    if (done >= queries.length) return { text: "Here is what the knowledge base says." };
    return { tool: "search_knowledge", input: { query: queries[done]! } };
  });
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    await run(t);
  },
});

export const NOV20_AGENT_LOOP_NO_REPEATED_TOOL_CALL_CASES: ReplayCase[] = [
  fixed("nov20-same-search-twice-runs-once", `"${QUESTION}": the model calls search_knowledge with the same query in two steps of one turn; the search runs once, and the second call gets the same result`, async (t) => {
    t.loopModel!(searches(["spray tan booth cleaning at close", "spray tan booth cleaning at close"]));
    await t.thread().say(QUESTION);
    expect(t.searches?.() ?? [], "the same search ran again in one turn").toHaveLength(1);
  }),
  fixed("nov20-different-searches-both-run", `Control: "${QUESTION}" with two different queries in one turn: both searches run`, async (t) => {
    t.loopModel!(searches(["spray tan booth cleaning at close", "closing checklist spray booth"]));
    await t.thread().say(QUESTION);
    expect(t.searches?.() ?? []).toHaveLength(2);
  }),
  fixed("nov20-same-search-after-a-write-runs-again", `Control: the same search, then a call that writes (propose_form), then the same search again in one turn: what was kept is cleared by the write, so the search runs again`, async (t) => {
    let step = 0;
    t.loopModel!(loopStandIn((view): LoopDecision => {
      step += 1;
      const quote = { message_id: view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.messageIds?.at(-1) ?? "current", quote: "Remy Calder" };
      if (step === 1 || step === 3) return { tool: "search_knowledge", input: { query: "late to shift attendance" } };
      if (step === 2) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quote, what_happened: "Was late to her shift on 11/18.", incident_date: "2026-11-18", policy: "Attendance" } };
      return { text: "Here's the Corrective Action Form for **Remy Calder**." };
    }));
    await t.thread().say("make a CA for Remy Calder, she was late to her shift on 11/18");
    expect(t.searches?.() ?? [], "a read after a write in the same turn was not read again").toHaveLength(2);
  }),
];
