import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE LEVEL SAID WITH THE REQUEST IS SET BY CODE (QA's live re-test on 63ba4c48, 16 Nov 2026: c_pay r1)
 * ============================================================================
 *
 * "written CA for <A>, late 11/14, payroll deduct $20": propose_form returned level_not_given (fact_keys: level_not_given,
 * unset) and the model stopped after one step without proposing again, so the reply said "Warning level isn't set" (r2
 * ticked Written: 1 miss in 2). The rule is now deterministic: on a Corrective Action card with no level from the model,
 * one Type of Warning option written right before one of the form's own words in THIS message ("written CA", "verbal
 * warning") is set by code, those words as typed being its evidence (the same verifyEvidence, person and offer checks as
 * the model's). The reply reads it back "as you said". "written closing checklist", "written up before" and a
 * termination stay unset. The stand-in here IGNORES level_not_given, as the live model did in r1.
 * Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test on 63ba4c48 (16 Nov 2026), c_pay r1: \"written CA for <A>, late 11/14, payroll deduct $20\" got level_not_given and the model did not propose again; the level stayed unset";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:20:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

type Facts = { stated?: { warning_level?: string }; stated_this_turn?: string[]; level_not_given?: unknown };
const proposeResult = (view: LoopView) => view.results.find((result) => result.tool === "propose_form")?.output as { facts?: Facts } | undefined;

/** c_pay r1's model: one propose_form with no warning_level (payroll given), then the reply; level_not_given is ignored. */
function ignoresLevelNotGiven(account: string, payroll: boolean) {
  const model = loopStandIn((view): LoopDecision => {
    if (!proposeResult(view)) {
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: account, incident_date: "2026-11-14", policy: "Attendance", ...(payroll ? { payroll_deduct: "yes", payroll_amount: "20", payroll_evidence: evidenceFrom(view, "payroll deduct $20") } : {}) } };
    }
    return { text: "Here's the Corrective Action Form for **Remy**." };
  });
  return model;
}

const levelOf = (reply: { formProposal?: unknown }) => (reply.formProposal as ChatFormProposal | undefined)?.warningLevel ?? null;

export const NOV16_AGENT_LOOP_LEVEL_SAID_IS_SET_CASES: ReplayCase[] = [
  {
    id: "nov16-level-said-is-set-c-pay-r1",
    title: "c_pay r1: \"written CA for remy calder, late 11/14, payroll deduct $20\" with a model that ignores level_not_given (one propose_form, no level): the card ticks Written Warning, stated as said this turn, with payroll Yes / $20",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = ignoresLevelNotGiven("Remy Calder was late on 11/14.", true);
      t.loopModel!(model);
      const reply = await t.thread().say("written CA for remy calder, late 11/14, payroll deduct $20");
      const card = reply.formProposal as ChatFormProposal | undefined;
      const facts = proposeResult(model.views.at(-1)!)?.facts ?? {};
      expect(card?.warningLevel, `the level said with the request was not set: ${JSON.stringify(facts)}`).toBe("written");
      expect(card?.payrollDeduct).toBe("yes");
      expect(card?.payrollDeductAmount).toBe("20");
      expect(facts.stated?.warning_level).toBe("written");
      expect(facts.stated_this_turn ?? [], "the level is not read back \"as you said\"").toContain("warning_level");
      expect(facts.level_not_given, "the fact is offered although the level is set").toBeUndefined();
    },
  },
  {
    id: "nov16-level-said-is-set-verbal-ca",
    title: "Same rule for Verbal: \"verbal ca for remy calder, late on 11/14\" with a model that sends no level ticks Verbal Warning",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(ignoresLevelNotGiven("Remy Calder was late on 11/14.", false));
      const reply = await t.thread().say("verbal ca for remy calder, late on 11/14");
      expect(levelOf(reply)).toBe("verbal");
    },
  },
  {
    id: "nov16-level-said-is-set-controls",
    title: "Controls (QA): \"…didn't follow the written closing checklist…\", \"…she was written up before, late 11/14\" and \"written CA for remy calder, we are terminating her…\" stay unset with the same model",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      for (const [message, account] of [
        ["CA for Remy Calder, she didn't follow the written closing checklist on 11/14", "Remy Calder did not follow the written closing checklist on 11/14."],
        ["ca for remy calder, she was written up before, late 11/14", "Remy Calder was late on 11/14."],
        ["written CA for remy calder, we are terminating her, late 11/14 again", "Remy Calder was late again on 11/14."],
      ] as const) {
        t.loopModel!(ignoresLevelNotGiven(account, false));
        const reply = await t.thread().say(message);
        expect(levelOf(reply), `${message}: a level was set`).toBeNull();
      }
    },
  },
];
