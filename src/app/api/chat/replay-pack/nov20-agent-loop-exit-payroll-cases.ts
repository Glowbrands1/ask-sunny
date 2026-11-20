import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE EXIT FORM HAS A PAYROLL QUESTION (QA item 16, 20 Nov 2026; the production audit's real exit form)
 * ============================================================================
 *
 * "create exit for <P>. payroll deduct no apply": Sunny replied "Payroll deduct isn't part of the exit form, so I haven't
 * recorded that on it." The exit form asks "Is Payroll Deduction applicable?". propose_form treated payroll as a
 * Corrective-Action-only field and refused it as not_on_this_form. General rule: a field is "not on this form" only when
 * the form's own template has no such field; payroll is kept (on the same evidence) for every form whose template asks
 * the payroll question. The warning level stays Corrective Action only. Invented name: Rowan Kestrel (the pack's roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), item 16, the production audit's exit form: \"Payroll deduct isn't part of the exit form\"";
type Out = { card?: unknown; not_on_card?: { field: string; reason_code: string }[] } | null;

export const NOV20_AGENT_LOOP_EXIT_PAYROLL_CASES: ReplayCase[] = [
  {
    id: "nov20-exit-payroll-is-on-the-exit-form",
    title: "\"create exit for <P>. payroll deduct no apply\": the exit card keeps payroll No (the form asks it), never not_on_this_form",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**." };
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation",
            exit_evidence: { ...evidenceFrom(view, "create exit for Rowan Kestrel"), kind: "asks_for_exit_form" },
            payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "payroll deduct no apply"),
          },
        };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("create exit for Rowan Kestrel. payroll deduct no apply");
      const result = lastResult(model.views.at(-1)!, "propose_form") as Out;
      expect(JSON.stringify(result?.not_on_card ?? []), "payroll was called not on the exit form").not.toMatch(/payroll_deduct/);
      expect((thread.proposal as { payrollDeduct?: string } | undefined)?.payrollDeduct, "the exit card lost the payroll answer").toBe("no");
    },
  },
  {
    id: "nov20-exit-payroll-control-level-not-on-exit",
    title: "Control: a warning level on the exit card is still not_on_this_form (the exit form has no level)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the card." };
        return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "create exit for Rowan Kestrel"), kind: "asks_for_exit_form" }, warning_level: "written", level_evidence: evidenceFrom(view, "written") } };
      });
      t.loopModel!(model);
      await t.thread().say("create exit for Rowan Kestrel, written");
      const result = lastResult(model.views.at(-1)!, "propose_form") as Out;
      expect(JSON.stringify(result?.not_on_card ?? [])).toMatch(/"warning_level","reason_code":"not_on_this_form"/);
    },
  },
];
