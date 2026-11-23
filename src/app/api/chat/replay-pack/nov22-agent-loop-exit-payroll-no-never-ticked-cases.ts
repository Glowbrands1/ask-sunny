import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * AN EXIT CARD WITH PAYROLL "NO" NEVER SAYS PAYROLL DEDUCTION IS TICKED (the 266-chat run's case 036, QA's step 3, 22 Nov 2026)
 * ============================================================================
 *
 * The manager's turns, word for word (the person invented, the pack's roster): "can you crate an exit form", then
 * "<P>, 11/22/26 will be her last day, she gave notice via email on 11/8/26, salon items will be returneded, payroll is
 * not deducted, they are eligiable for rehire". The loop's reply read "**Is payroll deduct applicable?** No, as you said."
 * and then "Payroll deduction is ticked as you said; the form has no amount line": it told the manager something false.
 *
 * Mechanism: propose_form's payroll_question_only fact (a form that asks payroll only as Yes / No) did not say what the
 * card holds, and the rules book told the model to say "payroll deduction is ticked as the manager said" whatever the
 * answer. The fact now leads with the card's own answer (Yes, No, or not set), and the rules book has the model say that
 * answer, never "ticked" for a No.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The 266-chat run (case 036), re-checked on main 7787aa9: \"**Is payroll deduct applicable?** No, as you said.\" then \"Payroll deduction is ticked as you said; the form has no amount line\"";
const T1 = "can you crate an exit form";
const T2 = "Marnie Holloway, 11/22/26 will be her last day, she gave notice via email on 11/8/26, salon items will be returneded, payroll is not deducted, they are eligiable for rehire";

type Out = { facts?: { payroll_question_only?: string } } | null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** The model says the payroll note's own first sentence, as the rules book has it read the card's answer. */
function exitModel(payroll: "yes" | "no", quote: string) {
  return loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as Out;
    if (result) return { text: `Here's the Resignation/Exit Form for **Marnie**. ${result.facts?.payroll_question_only?.split(/(?<=\.)\s/)[0] ?? ""}` };
    if (!view.turns.some((turn) => turn.role === "user" && turn.text.includes("last day"))) return { text: "Who is this Resignation/Exit Form for?" };
    return {
      tool: "propose_form",
      input: {
        template_key: "stc-exit", employee_id: "e-1", exit_type: "resignation",
        exit_evidence: { ...evidenceFrom(view, "can you crate an exit form", 1), kind: "asks_for_exit_form" },
        what_happened: "Marnie gave notice via email on 11/8/26; her last day will be 11/22/26.",
        payroll_deduct: payroll, payroll_evidence: evidenceFrom(view, quote),
      },
    };
  });
}

const notes = (model: ReturnType<typeof exitModel>) => model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => (result.output as Out)?.facts?.payroll_question_only ?? "").filter(Boolean);

export const NOV22_AGENT_LOOP_EXIT_PAYROLL_NO_NEVER_TICKED_CASES: ReplayCase[] = [
  {
    id: "nov22-f038-036-exit-payroll-no-never-ticked",
    title: "036: \"… payroll is not deducted …\" on an exit: the card's payroll note says No, and the reply never says payroll deduction is ticked",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const model = exitModel("no", "payroll is not deducted");
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      const reply = await thread.say(T2);
      expect((thread.proposal as { payrollDeduct?: string } | undefined)?.payrollDeduct, "the card does not hold payroll No (the case proves nothing)").toBe("no");
      const said = notes(model);
      expect(said.length, "no payroll note on the card (the case proves nothing)").toBeGreaterThan(0);
      expect(said.at(-1), "the payroll note does not say the card's answer").toMatch(/^Payroll deduction on the card: No\b/);
      expect(said.at(-1), "the payroll note says deduction is ticked on a No").not.toMatch(/\bticked\b/i);
      expect(reply.content, `the reply says payroll deduction is ticked after the manager said it is not deducted:\n${reply.content}`).not.toMatch(/deduction is ticked/i);
    },
  },
  {
    id: "nov22-f038-036-control-exit-payroll-yes",
    title: "control: \"… payroll is deducted for the uniform …\" on an exit: the card's payroll note says Yes",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const model = exitModel("yes", "payroll is deducted for the uniform");
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2.replace("payroll is not deducted", "payroll is deducted for the uniform"));
      expect((thread.proposal as { payrollDeduct?: string } | undefined)?.payrollDeduct).toBe("yes");
      expect(notes(model).at(-1), "the payroll note does not say the card's answer").toMatch(/^Payroll deduction on the card: Yes\b/);
    },
  },
];
