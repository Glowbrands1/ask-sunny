import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, firstMatch, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A FINAL WRITTEN WARNING IS ON THE FORM, ENDS ITS PLAN AS THE OWNER WROTE IT, AND IS NO TERMINATION
 * ============================================================================
 *
 * The owner's scope list from QA's Ask Vicki comparison (26 Nov 2026), kept from the first list: "A Final Written
 * Warning option on the Corrective Action / disciplinary form. Its standard Action Plan ending is "Further violations
 * may result in additional disciplinary action, up to and including termination, following leadership review." It is
 * not a termination, so no termination notice is sent."
 *
 * Revision 10 of the Corrective Action Form has the option; FINAL_WRITTEN_WARNING_ENABLED (off in production until QA
 * flips it) reads the manager's "final written" as it. Off, "final written" is still Written (Pau, 30 Oct 2026).
 * Remy Calder is invented (STAFF).
 */
const FLAG = "FINAL_WRITTEN_WARNING_ENABLED";
const REPORT = "The owner, 26 Nov 2026 (QA's Ask Vicki comparison): a Final Written Warning option with its own Action Plan ending, never a termination";
const SAID = "Final written warning for Remy Calder, late again today. No payroll deduct.";
const CLOSING = "Further violations may result in additional disciplinary action, up to and including termination, following leadership review.";

function standIn(view: LoopView): LoopDecision {
  if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
  if (!lastResult(view, "propose_form")) {
    return {
      tool: "propose_form",
      input: {
        template_key: "dpoa",
        employee_id: firstMatch(view)?.employee_id,
        policy: headingWith(view, /attendance|late/i),
        what_happened: "Remy Calder was late again today.",
        incident_date: "2026-11-26",
        // The rules book: "Final written" names Written, with level_evidence quoting it.
        warning_level: "written",
        level_evidence: evidenceFrom(view, "Final written warning"),
        payroll_deduct: "no",
        payroll_evidence: evidenceFrom(view, "No payroll deduct"),
      },
    };
  }
  return { text: "Here is the Corrective Action Form for Remy Calder." };
}

export const NOV26_FINAL_WRITTEN_WARNING_CASES: ReplayCase[] = [
  {
    id: "nov26-final-written-warning-card-create-plan",
    title: `"${SAID}": the card and the form are a Final Written Warning, the plan ends with the owner's closing, and no termination notice is given`,
    report: REPORT,
    status: { open: `${FLAG} is off in production: "final written" is Written there` },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-26T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn(standIn));
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(thread.proposal?.warningLevel, `the card's level:\n${reply.content}`).toBe("final_warning");
      expect(reply.content, "a termination notice for a warning").not.toMatch(/haven't selected a termination|tick Termination/i);
      t.draftWrites({ observation: "Observed:\nRemy Calder was late again today.", action_plan: "Management will review the Attendance Policy with Remy Calder." }, { warning_type: ["final_warning"] });
      const id = await thread.create();
      expect(t.checked(id).warning_type, "the saved form's Type of Warning").toEqual(["final_warning"]);
      const plan = t.values(id).action_plan ?? "";
      expect(plan.endsWith(CLOSING), `the Action Plan's ending:\n${plan}`).toBe(true);
      expect(plan, "the future-violations closing beside the final one").not.toMatch(/Future policy violations/);
      const bells = (t.rows?.("app_notifications") ?? []).map((row) => `${String(row.kind ?? "")} ${String(row.title ?? "")}`);
      expect(bells.filter((bell) => /terminat/i.test(bell)), "a termination notice was sent").toEqual([]);
    },
  },
];
