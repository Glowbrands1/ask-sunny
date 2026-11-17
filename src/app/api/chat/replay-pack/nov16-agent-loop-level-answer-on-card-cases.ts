import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A LEVEL ANSWERED ON THE OPEN CARD IS SET (Runner 2's c094 on train 4; QA 16 Nov 2026)
 * ============================================================================
 *
 * c094: T1 "Create me a corrective action for sanitation policy not done for <P>", T2 "Written form and no payroll
 * deducted": payroll No was set, the level stayed unset. "Written form": the option word right before the form's own word
 * ("form"), which the form's words left out, so neither the code-set level nor the model's quote counted it. The rule: a
 * level answer on the open CA card ("written form", "make it a verbal") is set the same deterministic way as one said with
 * the request. Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's c094 on train 4 (QA, 16 Nov 2026): \"Written form and no payroll deducted\" set payroll No and left the level unset";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T22:20:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });
const card = (proposal: unknown) => proposal as ChatFormProposal | null;

/** T1's card, then T2's answer: the model proposes the card again with payroll No and, per `levelSent`, the level or not. */
function c094(levelSent: boolean, t2: string) {
  return loopStandIn((view): LoopDecision => {
    if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Remy Calder**." };
    const base = { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: "Remy Calder did not complete the sanitation.", policy: "Other — sanitation not done" };
    if (managerTurns(view).length === 1) return { tool: "propose_form", input: base };
    return { tool: "propose_form", input: { ...base, payroll_deduct: "no", payroll_evidence: quoted(view, "no payroll deducted"), ...(levelSent ? { warning_level: "written", level_evidence: quoted(view, t2.split(" and ")[0]!) } : {}) } };
  });
}

export const NOV16_AGENT_LOOP_LEVEL_ANSWER_ON_CARD_CASES: ReplayCase[] = [
  ...([
    ["no-level-sent", false],
    ["level-sent-quoting-written-form", true],
  ] as const).map(([what, levelSent]): ReplayCase => ({
    id: `nov16-level-answer-on-card-c094-${what}`,
    title: `c094: "Create me a corrective action for sanitation policy not done for Remy Calder", then "Written form and no payroll deducted" (${levelSent ? "the model sends Written quoting \"Written form\"" : "the model sends no level"}): the card has Written Warning and payroll No`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(c094(levelSent, "Written form and no payroll deducted"));
      const thread = t.thread();
      await thread.say("Create me a corrective action for sanitation policy not done for Remy Calder");
      await thread.say("Written form and no payroll deducted");
      expect(card(thread.proposal)?.payrollDeduct).toBe("no");
      expect(card(thread.proposal)?.warningLevel, "the level answered on the open card was not set").toBe("written");
    },
  })),
  {
    id: "nov16-level-answer-on-card-make-it-a-verbal",
    title: "QA: \"make it a verbal\" on the open CA card, with a model that sends no level, sets Verbal Warning",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(c094(false, "make it a verbal"));
      const thread = t.thread();
      await thread.say("Create me a corrective action for sanitation policy not done for Remy Calder");
      await thread.say("make it a verbal");
      expect(card(thread.proposal)?.warningLevel, "the level answered on the open card was not set").toBe("verbal");
    },
  },
];
