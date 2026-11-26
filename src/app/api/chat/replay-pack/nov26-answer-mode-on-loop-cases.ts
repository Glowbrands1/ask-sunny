import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * QUICK AND DETAILED ARE ANSWERED BY THE AGENT LOOP (ANSWER_MODE_ON_LOOP; the owner, 26 Nov 2026: "B")
 * ============================================================================
 *
 * Every fix this week landed in the loop (Standard) and had to be copied to the older path that Quick and Detailed used
 * (the last: an admin's card asking which salon when Woven and the forms on file disagree). The owner chose one engine:
 * the Quick / Standard / Detailed buttons stay, and each turn is answered by the loop, the mode reaching it as one line
 * about the answer's length. These cases run the real route: a Quick or Detailed turn reaches the loop (never the older
 * path), carries its length line, and a Standard turn's prompt is unchanged.
 */
const REPORT = `The owner, 26 Nov 2026: "B" — keep the Quick / Standard / Detailed buttons, answer every mode with the agent loop`;
const FLAG = "ANSWER_MODE_ON_LOOP_ENABLED";
const SAID = "What does the policy say about cell phone use at the front desk?";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-26T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function standIn() {
  const systems: string[] = [];
  const model = loopStandIn((view: LoopView) => {
    systems.push(view.system);
    return { text: "the loop answered" };
  });
  return { model, systems };
}

const byMode = (mode: "quick" | "detailed", line: RegExp): ReplayCase => ({
  id: `nov26-answer-mode-${mode}-goes-to-the-loop`,
  title: `"${SAID}" in ${mode === "quick" ? "Quick" : "Detailed"}: the agent loop answers, with the ${mode} length line`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    const thread = start(t);
    const { model, systems } = standIn();
    t.loopModel!(model);
    const reply = await thread.say(SAID, {}, { mode });
    expect(model.calls, `a ${mode} turn went to the older path, not the loop`).toBeGreaterThan(0);
    expect(reply.content).toBe("the loop answered");
    expect(systems.at(-1) ?? "", `the ${mode} length line did not reach the loop`).toMatch(line);
  },
});

export const NOV26_ANSWER_MODE_ON_LOOP_CASES: ReplayCase[] = [
  byMode("quick", /Answer length: the manager chose Quick\. Answer a question in two or three sentences/),
  byMode("detailed", /Answer length: the manager chose Detailed\. Give the full picture/),
  {
    id: "nov26-answer-mode-standard-prompt-unchanged",
    title: `Control: "${SAID}" in Standard: the loop answers, and its prompt carries no length line`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const { model, systems } = standIn();
      t.loopModel!(model);
      const reply = await thread.say(SAID, {}, { mode: "standard" });
      expect(reply.content).toBe("the loop answered");
      expect(systems.at(-1) ?? "").not.toMatch(/Answer length:/);
    },
  },
];
