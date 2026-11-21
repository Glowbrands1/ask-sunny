import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A TIME RECORDS CARD AND ITS SAVED FORM AGREE (Runner 2's c259 re-run on c2b17d2; QA2, 21 Nov 2026, option (a))
 * ============================================================================
 *
 * c259: the loop card cited "Time Records Policy, JBA Policy Manual p.36", and Create saved Type of Offense
 * standards_of_conduct and Policy Violated "Standards of Conduct — Time Records": the card and the ticks disagreed. The
 * form has no Time Records box; Time Records is recorded under Standards of Conduct, as Pau was told (QA f071). Ruling
 * (a): the card says so too, "Standards of Conduct — Time Records, JBA Policy Manual p.36"; the form keeps the tick and
 * the line, and the Direct policy still quotes Time Records. On the real Create path; c259's words, the person invented.
 */

const TIME_RECORDS = { chunkIndex: 120, chunkId: "jba-120", locator: "Page 36 — Timekeeping & Payroll", page: 37, section: "Timekeeping & Payroll", printedPage: 36, sections: [{ page: 36, heading: "Timekeeping & Payroll" }, { page: 36, heading: "Time Records" }], content: "Timekeeping & Payroll\nEmployees record their own working time accurately.\nTime Records\nEmployees clock in at the start of their scheduled shift and clock out at its end, no more than a\nshort time after it unless a manager approves the extra time." };
/** c259 T1, word for word (the person invented). */
const SAID = "Please make me a CA form for Remy Calder for staying overhours until 9:53 on 11/4 and 11/11 until 10:19 pm. Remy said Remy was cleaning but it has been clear that we do not do extra cleaning after hours and this is not acceptable.";
const ACCOUNT = "Stayed over hours until 9:53 on 11/4 and on 11/11 until 10:19 pm. Remy said Remy was cleaning, but it has been clear that we do not do extra cleaning after hours and this is not acceptable.";
const REPORT = "Runner 2's c259 re-run on c2b17d2 (QA2, 21 Nov 2026): a Time Records card saved a standards_of_conduct tick the card never showed";

export const NOV21_TIME_RECORDS_TICKS_CASES: ReplayCase[] = [
  {
    id: "nov21-c259-time-records-card-and-ticks-agree",
    title: `c259: "${SAID}", the card citing Time Records: the card reads "Standards of Conduct — Time Records, JBA Policy Manual p.36", and Create ticks standards_of_conduct with the same line, quoting Time Records`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t: ReplayContext) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-17T00:10:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas!([TIME_RECORDS]);
      t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form") ? { text: "Here's the Corrective Action Form for **Remy**." } : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: ACCOUNT, policy: "Time Records" } }));
      t.draftWrites({ observation: `Observed:\n${ACCOUNT}` });
      const thread = t.thread();
      const reply = await thread.say(SAID);
      const line = String((reply.formProposal as { policyLine?: string } | undefined)?.policyLine ?? "");
      expect(line, "the card does not name the box the form ticks").toBe("Standards of Conduct \u2014 Time Records, JBA Policy Manual p.36");
      const id = await thread.create();
      expect(t.checked(id).offense_type ?? [], "Type of Offense").toEqual(["standards_of_conduct"]);
      const violated = t.values(id).policy_violated ?? "";
      expect(violated, "Policy Violated does not agree with the card").toMatch(/^Standards of Conduct \u2014 Time Records\b/);
      expect(line.startsWith(violated.replace(/,\s*JBA Policy Manual.*$/i, "")), `card "${line}" and Policy Violated "${violated}" disagree`).toBe(true);
      expect(t.values(id).policy_language ?? "", "the Direct policy is not Time Records' own wording").toMatch(/clock in at the start of their scheduled shift/);
    },
  },
];
