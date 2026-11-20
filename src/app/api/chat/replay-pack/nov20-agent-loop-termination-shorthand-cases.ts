import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * HR SHORTHAND FOR A TERMINATION IS A STATED TERMINATION (QA item 12, 20 Nov 2026; live production, a real manager)
 * ============================================================================
 *
 * "create exit for <P>. payroll deduct no apply", then "involuntary immediate term": propose_form refused the termination
 * twice (termination_not_stated), Sunny asked the manager to say it plainly ("terminate <P>" / "we fired <P>"), the card
 * stayed a resignation, and the manager hand-filled the termination fields. The lock (`termination-word.ts`) knew only
 * "terminat…", "term CA" and "fire…". General rule: the HR wording managers use for a termination ("term", "termed",
 * "involuntary", "immediate term", "let go", "separated", "job abandonment", "no call no show x3") carries a termination;
 * "voluntary" does not ("involuntary" vs "voluntary" picks termination vs resignation). The model still decides; the lock
 * only checks the words. QA's wording, word for word; invented name: Rowan Kestrel (the pack's roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), item 12, live production: \"create exit for <P>. payroll deduct no apply\" then \"involuntary immediate term\" was refused as termination_not_stated twice";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}
const userTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user");
type Out = { reason_code?: string; card?: unknown; not_on_card?: { field: string; reason_code: string }[]; exit_termination?: unknown; facts?: { exit_termination?: unknown } } | null;

/** The live model: the exit card asked for in T1; T2's words make it a termination (exit_type termination). */
const exitModel = () => loopStandIn((view): LoopDecision => {
  const card = lastResult(view, "propose_form") as Out;
  if (card) return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**." };
  const second = userTurns(view).length > 1;
  return {
    tool: "propose_form",
    input: {
      template_key: "stc-exit", employee_id: "e-4",
      exit_evidence: { ...evidenceFrom(view, "create exit for Rowan Kestrel", second ? 1 : 0), kind: "asks_for_exit_form" },
      exit_type: second ? "termination" : "resignation",
      ...(second ? { request_evidence: [evidenceFrom(view, undefined, 1), evidenceFrom(view, undefined, 0)] } : {}),
    },
  };
});

export const NOV20_AGENT_LOOP_TERMINATION_SHORTHAND_CASES: ReplayCase[] = [
  {
    id: "nov20-termination-shorthand-involuntary-immediate-term",
    title: "Live: \"create exit for <P>. payroll deduct no apply\", then \"involuntary immediate term\": the exit card is a termination, never termination_not_stated, never a request to rephrase",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      t.loopModel!(exitModel());
      await thread.say("create exit for Rowan Kestrel. payroll deduct no apply");
      expect(thread.proposal?.templateKey).toBe("stc-exit");
      const model = exitModel();
      t.loopModel!(model);
      await thread.say("involuntary immediate term");
      const result = model.views.flatMap((view) => view.results).filter((entry) => entry.tool === "propose_form").map((entry) => entry.output as Out).at(-1);
      expect(JSON.stringify(result?.not_on_card ?? []), "the shorthand was refused as no stated termination").not.toMatch(/termination_not_stated/);
      expect(JSON.stringify(result), "the card is not a termination").toMatch(/"exit_termination":/);
    },
  },
];
