import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE EXIT FORM'S PAYROLL QUESTION, WITH THE REASON IN ADDITIONAL DETAILS (QA, #1138's live test, 20 Nov 2026)
 * ============================================================================
 *
 * Production (main 45fab9ba): "exit form for <P>, resigned, last day 11/19, final paycheck should deduct the uniform cost"
 * got "The exit form doesn't have a field for the uniform-cost payroll deduction — you'll want to handle that separately",
 * and the card set no payroll. The exit form asks "Is Payroll Deduction applicable? (Yes / No)" and has no amount or reason
 * line. General rule: an exit card with the payroll question unanswered says so (unset payroll_deduct, as the Corrective
 * Action's card does), so the model never says the field is missing; and on a form whose payroll question has no amount
 * line, the card says so (payroll_question_only), the amount is not put on the form, and the stated reason and amount stay
 * in the account, which Create writes in Additional Details. QA's wording, word for word; invented name: Rowan Kestrel.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), #1138's live test (conv_mwp38enl2li2yl3 on 45fab9ba): \"The exit form doesn't have a field for the uniform-cost payroll deduction\"";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}
type Out = { card?: unknown; unset?: string[]; facts?: Record<string, unknown>; not_on_card?: { field: string; reason_code: string }[]; payroll_question_only?: unknown } | null;
const proposeResults = (views: readonly LoopView[]) => views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").map((result) => result.output as Out);
const LIVE_REPLY = "Here's the Resignation/Exit Form for **Rowan Kestrel**. The exit form doesn't have a field for the uniform-cost payroll deduction — you'll want to handle that separately (e.g. on a payroll form or note to payroll).";

/**
 * The live model: the exit card from the manager's words, with no payroll (it believed the form has no such field). Told by
 * the card that payroll is on the form and unset, it proposes again with the manager's answer, as it does for a CA.
 */
const exitModel = (said: string, account: string, amount?: string) => loopStandIn((view): LoopDecision => {
  const tries = view.results.filter((result) => result.tool === "propose_form");
  const last = tries.at(-1)?.output as Out | undefined;
  const base = {
    template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation",
    exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
    what_happened: account,
  };
  if (!last) return { tool: "propose_form", input: base };
  const unsetPayroll = ((last.facts as { unset?: string[] } | undefined)?.unset ?? last.unset ?? []).includes("payroll_deduct");
  // Changed on purpose (QA, #1158's live test, 20 Nov 2026): the card's payroll is decided on the first proposal (the exit
  // form's own reader over the request's words), so it is not "unset"; the model still adds a stated amount, once.
  const cardPayroll = (last.card as { payroll_deduct?: string | null } | undefined)?.payroll_deduct ?? null;
  if ((unsetPayroll || (amount && cardPayroll === "yes")) && tries.length === 1) {
    return { tool: "propose_form", input: { ...base, payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, said), ...(amount ? { payroll_amount: amount } : {}) } };
  }
  return { text: tries.length === 1 && cardPayroll !== "yes" ? LIVE_REPLY : "Here's the Resignation/Exit Form for **Rowan Kestrel**. Payroll deduction: Yes. The form has no amount line, so the uniform cost is in Additional Details." };
});

async function run(t: ReplayContext, said: string, quote: string, account: string, amount?: string) {
  start(t);
  const model = exitModel(quote, account, amount);
  t.loopModel!(model);
  const thread = t.thread();
  const reply = await thread.say(said);
  const results = proposeResults(model.views);
  const final = results.at(-1);
  expect(reply.content, `the reply says the exit form has no payroll field:\n${JSON.stringify(results[0]).slice(0, 1500)}`).not.toMatch(/doesn't have a field|does not have a field|handle that separately/i);
  expect((thread.proposal as { payrollDeduct?: string } | undefined)?.payrollDeduct, `payroll is not Yes on the card:\n${JSON.stringify(results)}`).toBe("yes");
  expect(JSON.stringify(final), "the card does not say the form has no amount line").toMatch(/"payroll_question_only":/);
  const id = await thread.create();
  const saved = JSON.stringify({ values: t.values(id), checked: t.checked(id) });
  expect(t.checked(id).payroll_deduction_applicable ?? [], `payroll is not ticked Yes on the form:\n${saved}`).toEqual(["yes"]);
  expect(t.values(id).details ?? "", `the reason is not in Additional Details:\n${saved}`).toMatch(/uniform/i);
  return { final, saved };
}

export const NOV20_AGENT_LOOP_EXIT_PAYROLL_REASON_CASES: ReplayCase[] = [
  {
    id: "nov20-exit-payroll-uniform-cost-ticked-reason-in-details",
    title: "Live: \"exit form for <P>, resigned, last day 11/19, final paycheck should deduct the uniform cost\": payroll is ticked Yes, the uniform cost is in Additional Details, and the reply never says the exit form has no payroll field",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await run(t, "exit form for Rowan Kestrel, resigned, last day 11/19, final paycheck should deduct the uniform cost", "final paycheck should deduct the uniform cost", "Resigned; last day 11/19. Final paycheck should deduct the uniform cost.");
    },
  },
  {
    id: "nov20-exit-payroll-uniform-forty-dollars-amount-in-details",
    title: "With an amount: \"exit form for <P>, resigned, last day 11/19, deduct $40 for the uniform\": payroll Yes, the $40 is not put on the form (no amount line: not_on_this_form) and stays in Additional Details with the reason",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { final, saved } = await run(t, "exit form for Rowan Kestrel, resigned, last day 11/19, deduct $40 for the uniform", "deduct $40 for the uniform", "Resigned; last day 11/19. Deduct $40 for the uniform.", "40");
      expect(JSON.stringify(final?.not_on_card ?? []), "the amount was not reported as not on this form").toMatch(/"field":"payroll_amount","reason_code":"not_on_this_form"/);
      expect(saved, "the $40 is not in Additional Details").toMatch(/\$40/);
    },
  },
];
