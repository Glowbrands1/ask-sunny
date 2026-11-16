import { expect, vi } from "vitest";

import type { ChatFormProposal as FormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A LEVEL SAID WITH THE REQUEST IS TICKED (QA's live re-test on 269ac0d9, 16 Nov 2026, item 2)
 * ============================================================================
 *
 * "written CA for <A>, late 11/14, payroll deduct $20" came back with payroll Yes / $20 and "Warning level isn't set; tell
 * me if it applies", while "verbal ca for <A>, late on 11/13" ticked Verbal. The live trace: one propose_form, no
 * level_not_stated reason, so the model sent no warning_level at all ("written CA" reads like the form's name). The general
 * rule: a Corrective Action card with no level, whose message names exactly one of the form's own Type of Warning options,
 * gets the fact level_not_given (as a card with no policy gets policy_not_given); the model proposes again with
 * warning_level and level_evidence, and the evidence check still decides. History ("written up before") stays unset.
 * Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test on 269ac0d9 (16 Nov 2026), item 2: \"written CA for <A>, late 11/14, payroll deduct $20\" left the warning level unset";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T15:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const factsOf = (output: Record<string, unknown>) => (output.facts ?? {}) as Record<string, unknown>;
const proposals = (view: LoopView) => view.results.filter((result) => result.tool === "propose_form");

/**
 * The live model's first call: the CA with the account, the date and payroll, and no warning_level. Proposed again only
 * when the result says level_not_given (with the level the manager's words state, quoted).
 */
function liveShape(levelWords: string, account: string) {
  return loopStandIn((view): LoopDecision => {
    const base = { template_key: "dpoa", employee_id: "e-2", what_happened: account, incident_date: "2026-11-14", policy: "Attendance", payroll_deduct: "yes", payroll_amount: "20", payroll_evidence: evidenceFrom(view, "payroll deduct $20") };
    const done = proposals(view);
    if (done.length === 0) return { tool: "propose_form", input: base };
    const notGiven = factsOf(done.at(-1)!.output).level_not_given as { option?: string } | undefined;
    if (done.length === 1 && notGiven?.option) return { tool: "propose_form", input: { ...base, warning_level: notGiven.option, level_evidence: evidenceFrom(view, levelWords) } };
    return { text: "Here's the Corrective Action Form for **Remy**." };
  });
}

export const NOV16_AGENT_LOOP_LEVEL_NOT_GIVEN_CASES: ReplayCase[] = [
  {
    id: "nov16-level-not-given-written-with-payroll",
    title: "QA's live re-test item 2: \"written CA for <A>, late 11/14, payroll deduct $20\" — the model sends no level; propose_form says level_not_given (Written), and the card ticks Written Warning with payroll Yes / $20",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const message = "written CA for remy calder, late 11/14, payroll deduct $20";
      t.loopModel!(liveShape("written CA", "Remy Calder was late on 11/14."));
      const thread = t.thread();
      const reply = await thread.say(message);
      const card = reply.formProposal as FormProposal | undefined;
      expect(card?.payrollDeduct).toBe("yes");
      expect(card?.payrollDeductAmount).toBe("20");
      expect(card?.warningLevel, `the level said with the request was not ticked: ${JSON.stringify(card)}`).toBe("written");
    },
  },
  {
    id: "nov16-level-not-given-control-history",
    title: "Control: \"ca for remy calder, she was written up before, late 11/14\" — history names Written, so level_not_given is offered, but the model's quote is not this form's level and the card stays unset (the stand-in does not propose again)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const message = "ca for remy calder, she was written up before, late 11/14";
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (proposals(view).length === 0) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/14.", incident_date: "2026-11-14", policy: "Attendance" } };
        return { text: "Here's the Corrective Action Form for **Remy**. Warning level isn't set; tell me if it applies." };
      }));
      const reply = await t.thread().say(message);
      expect((reply.formProposal as FormProposal | undefined)?.warningLevel ?? null).toBeNull();
    },
  },
];
