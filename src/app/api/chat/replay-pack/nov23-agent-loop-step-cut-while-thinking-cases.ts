import { expect, vi } from "vitest";

import { STEP_LIMIT_REPLY } from "@/lib/ai/agent-loop/replies";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A LOOP STEP CUT WHILE THINKING IS ASKED AGAIN WITH ITS TOOLS (port of Ask Bubbles #1060, 190a33d; its QA's live set, item 4)
 * ============================================================================
 *
 * Bubbles' manager turns, word for word (the mechanism ported, Sunny's own roster, salon and exit form; the person
 * invented): T1 "can you make me an exit form for <P> she is in woven under <P> <Last>. Her last day is nov 23 she is
 * returning her key she gave 2 weeks notice and is fulfilling them. no deduction at this time", then T5 "last day worked
 * will be nov 23, notice was given last Monday, eligible for rehire, notice will be attached, leave address blank I will
 * fill it in". Live (Bubbles), T5 answered "I couldn't finish that in the steps I have for one message": the first model
 * call ended "length" with no text and no tool call (adaptive thinking spent the step's output budget), and the
 * truncation retry, asked without tools, ended with no text. Sunny's `run.ts` has the same retry.
 *
 * The stand-in plays that: T5's first call is cut with nothing written; the next call, offered the tools, proposes the
 * card. On main the retry has no tools, so the call is never run and the reply is STEP_LIMIT_REPLY. The stand-in is an
 * app condition (a cut at the output limit) a real model cannot be made to show, so the cases do not run live.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles #1060 (its QA's live regression set, 22 Nov 2026, item 4): T5 \"last day worked will be nov 23, … leave address blank I will fill it in\" answered \"I couldn't finish that in the steps I have for one message\"; the first call was cut while thinking, and the retry had no tools";
const T1 = "can you make me an exit form for Marnie she is in woven under Marnie Holloway. Her last day is nov 23 she is returning her key she gave 2 weeks notice and is fulfilling them. no deduction at this time";
const T5 = "last day worked will be nov 23, notice was given last Monday, eligible for rehire, notice will be attached, leave address blank I will fill it in";

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";

const propose = (view: LoopView): LoopDecision => {
  const asks = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
  const firstBack = asks.length - 1 - asks.findIndex((turn) => turn.text.startsWith("can you make me an exit form"));
  return {
    tool: "propose_form",
    input: {
      template_key: "stc-exit", employee_id: "e-1", exit_type: "resignation",
      exit_evidence: { ...evidenceFrom(view, "can you make me an exit form", firstBack), kind: "asks_for_exit_form" },
      what_happened: "Marnie gave 2 weeks notice and is fulfilling it.",
      payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "no deduction at this time", firstBack),
    },
  };
};

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

export const NOV23_AGENT_LOOP_STEP_CUT_WHILE_THINKING_CASES: ReplayCase[] = [
  {
    id: "nov23-step-cut-while-thinking-is-asked-again-with-tools",
    title: "Port of Bubbles #1060: T5 \"last day worked will be nov 23, … eligible for rehire, …\" whose first model call is cut while thinking (no text, no tool call): the step is asked again with its tools, T5 makes the card, and the reply is never the step-limit reply",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      /* Counted here: a retry's prompt leaves the cut call out, so the view's own step reads 0 again. */
      let cut = false;
      const model = loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Marnie**." };
        if (said(view) === T5 && !cut) {
          cut = true;
          return { text: "", cut: true };
        }
        return propose(view);
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      const views = model.views.length;
      const reply = await thread.say(T5);
      expect(cut, "T5's first call was not cut (the case proves nothing)").toBe(true);
      expect(reply.content, "T5 ended at the step limit").not.toBe(STEP_LIMIT_REPLY);
      expect(reply.content, `T5's reply:\n${reply.content}`).not.toMatch(/couldn't finish that in the steps/);
      const madeCard = model.views.slice(views).some((view) => lastResult(view, "propose_form") !== null);
      expect(madeCard, "T5 made no card: the call the step was thinking towards never ran").toBe(true);
    },
  },
  {
    id: "nov23-step-cut-mid-reply-is-rewritten-without-tools",
    title: "Control (TRUNCATION_RETRY, parity gap #36): a reply cut mid-text after the card is written again without tools, so propose_form is never called twice",
    report: `${REPORT}; the cut-reply retry stays as it was`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      let proposed = 0;
      let replies = 0;
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "propose_form")) {
          proposed += 1;
          return propose(view);
        }
        replies += 1;
        return replies === 1 ? { text: "Here's the Resignation/Exit Form for", cut: true } : { text: "Here's the Resignation/Exit Form for **Marnie**." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say(T1);
      expect(proposed, "propose_form was called again by the retry").toBe(1);
      expect(reply.content).toMatch(/^Here's the Resignation\/Exit Form for \*\*Marnie\*\*\./);
      expect(thread.proposal?.employeeName).toBe("Marnie Holloway");
    },
  },
];
