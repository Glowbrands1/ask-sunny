import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE EXIT CARD, ITS REPLY AND THE SAVED FORM AGREE (QA, #1158's live test, 20 Nov 2026; build 88a10bc5)
 * ============================================================================
 *
 * "exit form for <P>, resigned, last day 11/19, final paycheck should deduct the uniform cost" (draft 6d887fb3): the SAVED
 * form had payroll Yes (Create's exit reader read it), but the card had none and the reply said "Payroll deduct isn't set;
 * tell me if it applies"; and the reply said "Filed as a resignation", while the saved form ticked no resignation type.
 * General rule: one decision feeds the card, the reply and the saved form. The exit card's payroll is the model's answer
 * on evidence, else the exit form's own reader over THIS request's words (the one Create uses); its resignation-type
 * ticks are the reader's too, and with none the card asks how the person left (it never says "Filed as" a type the form
 * will not tick). QA's wording, word for word; invented name: Rowan Kestrel.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), #1158's live test (conv_mwpgm6xq2b37ip8, draft 6d887fb3 on 88a10bc5): the card said payroll unset and \"Filed as a resignation\" while the saved form had payroll Yes and no type";
const SAID = "exit form for Rowan Kestrel, resigned, last day 11/19, final paycheck should deduct the uniform cost";

type Facts = { unset?: string[]; exit_unset?: string[]; exit_ticks?: string[] };
type Out = { card?: { payroll_deduct?: string | null }; facts?: Facts } | null;

export const NOV20_AGENT_LOOP_EXIT_ONE_DECISION_CASES: ReplayCase[] = [
  {
    id: "nov20-exit-one-decision-payroll-and-type",
    title: "#1158 live: \"exit form for <P>, resigned, last day 11/19, final paycheck should deduct the uniform cost\" (the model passes no payroll): the card has payroll Yes, the reply never says it is unset, and the reply says \"Filed as\" a type only when the saved form ticks it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-20T19:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      // The live model: the exit card with no payroll; its reply follows the card's facts, as the rules book teaches.
      const model = loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as Out;
        if (!result) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" }, what_happened: "Resigned; last day 11/19. Final paycheck should deduct the uniform cost." } };
        const facts = result.facts ?? {};
        return {
          text: [
            "Here's the Resignation/Exit Form for **Rowan Kestrel**.",
            (facts.unset ?? []).includes("payroll_deduct") ? "Payroll deduct isn't set; tell me if it applies." : `Payroll deduction: ${result.card?.payroll_deduct === "yes" ? "Yes" : "No"}.`,
            (facts.exit_ticks ?? []).length > 0 ? `Filed as: ${facts.exit_ticks!.join(", ")}.` : (facts.exit_unset ?? []).includes("resignation_type") ? "How did Rowan leave: notice given and fulfilled, an immediate resignation, notice not fulfilled, or a no call no show?" : "Filed as a resignation, from \"resigned.\"",
          ].join(" "),
        };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      const result = lastResult(model.views.at(-1)!, "propose_form") as Out;
      expect((thread.proposal as { payrollDeduct?: string } | undefined)?.payrollDeduct, `the card has no payroll:\n${JSON.stringify(result).slice(0, 800)}`).toBe("yes");
      expect(reply.content, "the reply says payroll is unset").not.toMatch(/isn't set/i);
      const id = await thread.create();
      const checked = t.checked(id);
      const saved = JSON.stringify({ values: t.values(id), checked });
      expect(checked.payroll_deduction_applicable ?? [], `the saved form's payroll disagrees with the card:\n${saved}`).toEqual(["yes"]);
      // Whatever the reply says it filed is ticked on the saved form; nothing ticked, the reply asks instead.
      const filed = /Filed as/i.test(reply.content);
      const ticked = (checked.resignation_type ?? []).length > 0 || (checked.resignation_notice ?? []).length > 0;
      expect(filed, `the reply says "Filed as" but the saved form ticks no type (or ticks one the reply hid):\n${reply.content}\n${saved}`).toBe(ticked);
      expect(t.values(id).resignation_reason ?? "", "a resignation reason the manager never gave was saved").toBe("");
    },
  },
];
